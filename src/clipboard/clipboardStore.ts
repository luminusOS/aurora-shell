import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

import type { LinkPreview } from './linkPreview.ts';
import { callAsync } from '~/core/callAsync.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { createManagedTimeout } from '~/core/mainLoop.ts';
import { logger } from '~/core/logger.ts';
import {
  encodeAddOp,
  encodeCompactedLog,
  encodeDeleteOp,
  encodeMoveOp,
  encodePinOp,
  encodeUnpinOp,
  parseClipboardLog,
  removeClipboardEntry,
  type ClipboardEntrySnapshot,
} from '~/clipboard/clipboardLog.ts';

// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_contents_async');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'append_to_async', 'append_to_finish');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.OutputStream.prototype, 'write_all_async', 'write_all_finish');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.OutputStream.prototype, 'flush_async', 'flush_finish');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');

const LOG_PREFIX = 'ClipboardHistory';
const WRITE_PRIORITY = GLib.PRIORITY_DEFAULT_IDLE;
const MAX_WASTED_OPS = 500;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const THUMBNAIL_SIZE = 640;

export type ClipboardEntry = ClipboardEntrySnapshot & {
  preview?: LinkPreview;
};

export function thumbnailPathFor(filePath: string): string {
  return filePath.replace(/\.[^./]+$/, '') + '.thumb.png';
}

export type ClipboardImagePayload = {
  mimeType: string;
  bytes: GLib.Bytes;
  fingerprint: string;
};

const activeTemporaryFiles = new Set<string>();
const TEMPORARY_MEDIA_NAME =
  /^[0-9]+\.(?:png|jpg|webp|gif|bmp|tiff)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:tmp|thumb\.png)$/;

export class ClipboardStore {
  private _pinned: ClipboardEntry[] = [];
  private _history: ClipboardEntry[] = [];
  private _byId = new Map<string, ClipboardEntry>();
  private _byContentKey = new Map<string, ClipboardEntry>();
  private _nextId: number = 1;
  private _wastedOps: number = 0;
  private _filePath: string;
  private _mediaDir: string;
  private _pendingWrites: string[] = [];
  private _writing: boolean = false;
  private _compactionRequested: boolean = false;
  private _needsRecovery = false;
  private _retryLifecycle = new LifecycleScope();
  private _retryTimeout = createManagedTimeout(this._retryLifecycle);
  private _retryDelay = INITIAL_RETRY_DELAY;
  private _failureReported = false;
  private _onPersistenceError: (() => void) | null;
  private _clearVersion = 0;
  private _imageCancellable = new Gio.Cancellable();
  private _captureCancellables = new Set<Gio.Cancellable>();
  private _imageVersion = 0;

  constructor(filePath: string, mediaDir: string, onPersistenceError?: () => void) {
    this._filePath = filePath;
    this._mediaDir = mediaDir;
    this._onPersistenceError = onPersistenceError || null;
  }

  async load(): Promise<void> {
    const clearVersion = this._clearVersion;
    await this._removeOrphanedTemporaryFiles();
    try {
      const file = Gio.File.new_for_path(this._filePath);
      const bytes = await callAsync(
        (callback) => file.load_bytes_async(null, callback),
        (result) => file.load_bytes_finish(result)[0],
      );
      const decoded = new TextDecoder().decode(bytes.get_data() || new Uint8Array());
      const state = parseClipboardLog(decoded);
      const { pinned, history, removed } = await this._dropInvalidImageEntries(
        state.pinned,
        state.history,
      );
      if (this._clearVersion !== clearVersion) return;

      this._pinned = pinned;
      this._history = history;
      this._nextId = state.nextId;
      this._wastedOps = state.wastedOps + removed;
      this._rebuildIndexes();
      if (removed > 0) {
        this._compactionRequested = true;
        void this._drainWrites();
      }
      this._requestCompactionIfNeeded();
    } catch (_e) {
      if (this._clearVersion !== clearVersion) return;

      this._pinned = [];
      this._history = [];
      this._nextId = 1;
      this._wastedOps = 0;
      this._rebuildIndexes();
    }
  }

  save(): void {
    this._requestCompactionIfNeeded();
  }

  destroy(): void {
    this._retryLifecycle.dispose();
    this._clearVersion++;
    this.discardPendingImages();
    this._imageCancellable.cancel();
  }

  addText(text: string): boolean {
    const cleanText = text.trim();
    if (!cleanText) return false;

    const contentKey = 'text:' + text;
    const existing = this._byContentKey.get(contentKey);
    if (existing) {
      this._moveToFront(existing);
      this._wastedOps++;
      this._appendLog(encodeMoveOp(existing.id));
      this._requestCompactionIfNeeded();
      return true;
    }

    const entry: ClipboardEntry = {
      id: String(this._nextId++),
      kind: 'text',
      text,
      pinned: false,
      timestamp: Date.now(),
      contentKey,
    };
    this._history.unshift(entry);
    this._byId.set(entry.id, entry);
    this._byContentKey.set(entry.contentKey, entry);
    this._appendLog(encodeAddOp(entry));
    return true;
  }

  async addImage(payload: ClipboardImagePayload): Promise<boolean> {
    if (payload.bytes.get_size() === 0) return false;

    const contentKey = 'image:' + payload.mimeType + ':' + payload.fingerprint;
    const existing = this._byContentKey.get(contentKey);
    if (existing) {
      this._moveToFront(existing);
      this._wastedOps++;
      this._appendLog(encodeMoveOp(existing.id));
      this._requestCompactionIfNeeded();
      return true;
    }

    const id = String(this._nextId++);
    const imageVersion = this._imageVersion;
    const cancellable = new Gio.Cancellable();
    this._captureCancellables.add(cancellable);
    const filePath = this._mediaDir + '/' + id + this._extensionForMimeType(payload.mimeType);
    const temporaryPath = `${filePath}.${GLib.uuid_string_random()}.tmp`;
    activeTemporaryFiles.add(temporaryPath);
    activeTemporaryFiles.add(thumbnailPathFor(temporaryPath));
    let hasThumbnail = false;
    try {
      await this._writeImage(temporaryPath, payload.bytes, cancellable);
      await this._validateImageFileAsync(temporaryPath, payload.mimeType, cancellable);
      const pixbuf = await this._decodeThumbnail(temporaryPath, cancellable);

      try {
        await this._writeThumbnail(temporaryPath, pixbuf, cancellable);
        hasThumbnail = true;
      } catch (e) {
        if (cancellable.is_cancelled()) {
          this._deleteMediaPath(temporaryPath);
          return false;
        }

        this._deletePath(thumbnailPathFor(temporaryPath));
        logger.warn(
          'Failed to create clipboard image thumbnail:',
          { prefix: LOG_PREFIX },
          e as Error,
        );
      }

      if (cancellable.is_cancelled() || this._imageVersion !== imageVersion) {
        this._deleteMediaPath(temporaryPath);
        return false;
      }

      if (hasThumbnail) {
        Gio.File.new_for_path(thumbnailPathFor(temporaryPath)).move(
          Gio.File.new_for_path(thumbnailPathFor(filePath)),
          Gio.FileCopyFlags.OVERWRITE,
          cancellable,
          null,
        );
      }
      Gio.File.new_for_path(temporaryPath).move(
        Gio.File.new_for_path(filePath),
        Gio.FileCopyFlags.OVERWRITE,
        cancellable,
        null,
      );
    } catch (e) {
      this._deleteMediaPath(temporaryPath);
      if (hasThumbnail) this._deleteMediaPath(filePath);
      if (cancellable.is_cancelled()) return false;

      logger.warn(
        `Rejected clipboard image: ${payload.mimeType}, ${payload.bytes.get_size()} bytes`,
        { prefix: LOG_PREFIX },
        e as Error,
      );
      return false;
    } finally {
      this._captureCancellables.delete(cancellable);
      activeTemporaryFiles.delete(temporaryPath);
      activeTemporaryFiles.delete(thumbnailPathFor(temporaryPath));
    }

    const entry: ClipboardEntry = {
      id,
      kind: 'image',
      text: 'Image',
      pinned: false,
      timestamp: Date.now(),
      mimeType: payload.mimeType,
      filePath,
      contentKey,
    };
    this._history.unshift(entry);
    this._byId.set(entry.id, entry);
    this._byContentKey.set(entry.contentKey, entry);
    this._appendLog(encodeAddOp(entry));
    return true;
  }

  pin(id: string): void {
    const entry = this._byId.get(id);
    if (!entry || entry.pinned) return;

    removeClipboardEntry(this._history, entry);
    entry.pinned = true;
    this._pinned.unshift(entry);
    this._appendLog(encodePinOp(id));
  }

  unpin(id: string): void {
    const entry = this._byId.get(id);
    if (!entry || !entry.pinned) return;

    removeClipboardEntry(this._pinned, entry);
    entry.pinned = false;
    this._history.unshift(entry);
    this._wastedOps += 2;
    this._appendLog(encodeUnpinOp(id));
    this._requestCompactionIfNeeded();
  }

  remove(id: string): void {
    const entry = this._byId.get(id);
    if (!entry) return;

    removeClipboardEntry(this._pinned, entry);
    removeClipboardEntry(this._history, entry);
    this._byId.delete(id);
    this._byContentKey.delete(entry.contentKey);
    this._deleteMediaFile(entry);
    this._wastedOps += entry.pinned ? 3 : 2;
    this._appendLog(encodeDeleteOp(id));
    this._requestCompactionIfNeeded();
  }

  discardPendingImages(): void {
    this._imageVersion++;
    for (const cancellable of this._captureCancellables) cancellable.cancel();
  }

  clear(): boolean {
    this._clearVersion++;
    this.discardPendingImages();
    const entries = this._history;
    if (entries.length === 0) {
      this._compactionRequested = true;
      void this._drainWrites();
      return false;
    }

    for (const entry of entries) this._deleteMediaFile(entry);

    this._history = [];
    for (const entry of entries) {
      this._byId.delete(entry.id);
      this._byContentKey.delete(entry.contentKey);
    }
    this._wastedOps += entries.length;
    this._appendLog(entries.map((entry) => encodeDeleteOp(entry.id)).join(''));
    this._compactionRequested = true;
    void this._drainWrites();
    return true;
  }

  getPinned(): ClipboardEntry[] {
    return this._pinned;
  }

  entryForText(text: string): ClipboardEntry | undefined {
    return this._byContentKey.get('text:' + text);
  }

  getHistory(): ClipboardEntry[] {
    return this._history;
  }

  filterPinned(query: string): ClipboardEntry[] {
    if (!query) return this._pinned;
    const q = query.toLowerCase();
    return this._pinned.filter((e) => this._searchText(e).includes(q));
  }

  filterHistory(query: string): ClipboardEntry[] {
    if (!query) return this._history;
    const q = query.toLowerCase();
    return this._history.filter((e) => this._searchText(e).includes(q));
  }

  private _moveToFront(entry: ClipboardEntry): void {
    const list = entry.pinned ? this._pinned : this._history;
    removeClipboardEntry(list, entry);
    list.unshift(entry);
  }

  private _rebuildIndexes(): void {
    this._byId.clear();
    this._byContentKey.clear();
    for (const entry of [...this._pinned, ...this._history]) {
      if (entry.kind === undefined) entry.kind = 'text';
      if (entry.contentKey === undefined) {
        entry.contentKey = entry.kind === 'image' ? 'image:' + entry.id : 'text:' + entry.text;
      }
      this._byId.set(entry.id, entry);
      this._byContentKey.set(entry.contentKey, entry);
    }
  }

  private async _dropInvalidImageEntries(
    pinned: ClipboardEntry[],
    history: ClipboardEntry[],
  ): Promise<{ pinned: ClipboardEntry[]; history: ClipboardEntry[]; removed: number }> {
    const invalid = new Set<ClipboardEntry>();
    const images = [...pinned, ...history].filter((entry) => entry.kind === 'image');

    for (const entry of images) {
      let pixbuf: GdkPixbuf.Pixbuf;
      try {
        if (!entry.filePath || !entry.mimeType) throw new Error('Image entry has no file');
        await this._validateImageFileAsync(entry.filePath, entry.mimeType);
        pixbuf = await this._decodeThumbnail(entry.filePath);
      } catch (e) {
        if (this._imageCancellable.is_cancelled()) break;

        invalid.add(entry);
        logger.warn(
          `Dropped invalid clipboard image from history: id=${entry.id}, path=${entry.filePath || '(none)'}`,
          { prefix: LOG_PREFIX },
          e as Error,
        );
        this._deleteMediaFile(entry);
        continue;
      }

      try {
        await this._writeThumbnail(entry.filePath, pixbuf);
      } catch (e) {
        if (this._imageCancellable.is_cancelled()) break;

        logger.warn(
          `Failed to refresh clipboard image thumbnail: id=${entry.id}, path=${entry.filePath}`,
          { prefix: LOG_PREFIX },
          e as Error,
        );
      }
    }

    const keepValid = (entry: ClipboardEntry): boolean => !invalid.has(entry);
    return {
      pinned: pinned.filter(keepValid),
      history: history.filter(keepValid),
      removed: invalid.size,
    };
  }

  private _appendLog(data: string): void {
    this._pendingWrites.push(data);
    void this._drainWrites();
  }

  private _requestCompactionIfNeeded(): void {
    if (this._wastedOps < MAX_WASTED_OPS) return;
    this._compactionRequested = true;
    void this._drainWrites();
  }

  private async _drainWrites(): Promise<void> {
    if (this._writing || this._retryTimeout.active) return;
    this._writing = true;
    let failures = 0;

    try {
      while (this._pendingWrites.length > 0 || this._compactionRequested || this._needsRecovery) {
        try {
          if (this._needsRecovery) {
            // A failed append may have written any prefix, so replace it with a fresh snapshot.
            this._pendingWrites = [];
            this._compactionRequested = false;
            await this._compactLog();
            this._needsRecovery = false;
            this._retryDelay = INITIAL_RETRY_DELAY;
            this._failureReported = false;
          } else if (this._pendingWrites.length > 0) {
            const batch = this._pendingWrites.join('');
            this._pendingWrites = [];
            await this._appendBatch(batch);
          } else if (this._compactionRequested) {
            this._compactionRequested = false;
            await this._compactLog();
          }
          failures = 0;
        } catch (error) {
          this._needsRecovery = true;
          failures++;
          if (failures >= 3) {
            if (!this._failureReported) {
              logger.error(
                'Failed to write clipboard history log:',
                { prefix: LOG_PREFIX },
                error as Error,
              );
              if (this._onPersistenceError) this._onPersistenceError();
              this._failureReported = true;
            }
            this._retryTimeout.schedule(this._retryDelay, () => void this._drainWrites());
            this._retryDelay = Math.min(this._retryDelay * 2, MAX_RETRY_DELAY);
            break;
          }
        }
      }
    } finally {
      this._writing = false;
    }
  }

  private async _appendBatch(data: string): Promise<void> {
    this._ensureDirectory();
    const stream = await Gio.File.new_for_path(this._filePath).append_to_async(
      Gio.FileCreateFlags.PRIVATE,
      WRITE_PRIORITY,
      null,
    );

    try {
      let bytes = new GLib.Bytes(new TextEncoder().encode(data));
      while (bytes.get_size() > 0) {
        const written = await callAsync<number>(
          (callback) => stream.write_bytes_async(bytes, WRITE_PRIORITY, null, callback),
          (result) => stream.write_bytes_finish(result),
        );
        if (written <= 0) throw new Error('Clipboard log write made no progress');
        bytes = GLib.Bytes.new_from_bytes(bytes, written, bytes.get_size() - written);
      }
      await stream.flush_async(WRITE_PRIORITY, null);
    } finally {
      await stream.close_async(WRITE_PRIORITY, null);
    }
  }

  private async _compactLog(): Promise<void> {
    this._ensureDirectory();
    const entries = [...this._history].reverse().concat([...this._pinned].reverse());
    const data = encodeCompactedLog(entries);
    // Gio's async replacement can stall on a zero-length GJS buffer.
    const bytes = new TextEncoder().encode(data || '\n');

    await Gio.File.new_for_path(this._filePath).replace_contents_async(
      bytes,
      null,
      false,
      Gio.FileCreateFlags.PRIVATE,
      null,
    );
    this._wastedOps = 0;
  }

  private _ensureDirectory(): void {
    GLib.mkdir_with_parents(GLib.path_get_dirname(this._filePath), 0o700);
  }

  private _ensureMediaDirectory(): void {
    GLib.mkdir_with_parents(this._mediaDir, 0o700);
  }

  private async _removeOrphanedTemporaryFiles(): Promise<void> {
    const directory = Gio.File.new_for_path(this._mediaDir);
    let enumerator: Gio.FileEnumerator;
    try {
      enumerator = await callAsync(
        (callback) =>
          directory.enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT,
            null,
            callback,
          ),
        (result) => directory.enumerate_children_finish(result),
      );
    } catch (e) {
      if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return;
      logger.warn(
        'Failed to inspect clipboard temporary files:',
        { prefix: LOG_PREFIX },
        e as Error,
      );
      return;
    }
    try {
      while (true) {
        const files = await callAsync(
          (callback) => enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, null, callback),
          (result) => enumerator.next_files_finish(result),
        );
        if (files.length === 0) break;
        for (const info of files) {
          const name = info.get_name();
          if (info.get_file_type() !== Gio.FileType.REGULAR || !TEMPORARY_MEDIA_NAME.test(name))
            continue;
          const file = directory.get_child(name);
          const path = file.get_path();
          if (!path || activeTemporaryFiles.has(path)) continue;
          try {
            file.delete(null);
          } catch (e) {
            if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
              continue;
            logger.warn(
              'Failed to remove clipboard temporary file:',
              { prefix: LOG_PREFIX },
              e as Error,
            );
          }
        }
      }
    } catch (e) {
      logger.warn(
        'Failed to inspect clipboard temporary files:',
        { prefix: LOG_PREFIX },
        e as Error,
      );
    } finally {
      enumerator.close(null);
    }
  }

  private async _writeImage(
    filePath: string,
    bytes: GLib.Bytes,
    cancellable: Gio.Cancellable = this._imageCancellable,
  ): Promise<void> {
    this._ensureMediaDirectory();
    const file = Gio.File.new_for_path(filePath);
    await callAsync(
      (callback) =>
        file.replace_contents_bytes_async(
          bytes,
          null,
          false,
          Gio.FileCreateFlags.PRIVATE,
          cancellable,
          callback,
        ),
      (result) => file.replace_contents_finish(result),
    );
  }

  private async _decodeThumbnail(
    filePath: string,
    cancellable: Gio.Cancellable = this._imageCancellable,
  ): Promise<GdkPixbuf.Pixbuf> {
    const source = Gio.File.new_for_path(filePath);
    const input = await callAsync(
      (callback) => source.read_async(GLib.PRIORITY_DEFAULT, cancellable, callback),
      (result) => source.read_finish(result),
    );
    return callAsync(
      (callback) =>
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
          input,
          THUMBNAIL_SIZE,
          THUMBNAIL_SIZE,
          true,
          cancellable,
          callback,
        ),
      (result) => GdkPixbuf.Pixbuf.new_from_stream_finish(result),
    ).finally(() => input.close(null));
  }

  // PNG encoding runs on a GdkPixbuf worker thread.
  private async _writeThumbnail(
    filePath: string,
    pixbuf: GdkPixbuf.Pixbuf,
    cancellable: Gio.Cancellable = this._imageCancellable,
  ): Promise<void> {
    const target = Gio.File.new_for_path(thumbnailPathFor(filePath));
    const output = await callAsync(
      (callback) =>
        target.replace_async(
          null,
          false,
          Gio.FileCreateFlags.PRIVATE,
          GLib.PRIORITY_DEFAULT,
          cancellable,
          callback,
        ),
      (result) => target.replace_finish(result),
    );
    try {
      await callAsync(
        (callback) =>
          pixbuf.save_to_streamv_async(output, 'png', null, null, cancellable, callback),
        (result) => GdkPixbuf.Pixbuf.save_to_stream_finish(result),
      );
    } finally {
      await output.close_async(GLib.PRIORITY_DEFAULT, null);
    }
  }

  private _deleteMediaFile(entry: ClipboardEntry): void {
    if (entry.kind !== 'image' || !entry.filePath) return;
    this._deleteMediaPath(entry.filePath);
  }

  private _deleteMediaPath(filePath: string): void {
    for (const path of [filePath, thumbnailPathFor(filePath)]) this._deletePath(path);
  }

  private _deletePath(path: string): void {
    try {
      Gio.File.new_for_path(path).delete(null);
    } catch (e) {
      if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return;
      logger.warn(`Failed to delete clipboard media: ${path}`, { prefix: LOG_PREFIX }, e);
    }
  }

  private _extensionForMimeType(mimeType: string): string {
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';
    if (mimeType === 'image/webp') return '.webp';
    if (mimeType === 'image/gif') return '.gif';
    if (mimeType === 'image/bmp') return '.bmp';
    if (mimeType === 'image/tiff') return '.tiff';
    return '.png';
  }

  // Reads only the image header, on a GdkPixbuf worker thread.
  private async _validateImageFileAsync(
    filePath: string,
    mimeType: string,
    cancellable: Gio.Cancellable = this._imageCancellable,
  ): Promise<void> {
    const [format] = await callAsync(
      (callback) => GdkPixbuf.Pixbuf.get_file_info_async(filePath, cancellable, callback),
      (result) => GdkPixbuf.Pixbuf.get_file_info_finish(result),
    );
    const expectedMimeType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    if (!format?.get_mime_types()?.includes(expectedMimeType)) {
      throw new Error(`Image data does not match ${mimeType}`);
    }
  }

  private _searchText(entry: ClipboardEntry): string {
    if (entry.kind === 'image') return 'image imagem picture photo foto';
    return entry.text.toLowerCase();
  }
}
