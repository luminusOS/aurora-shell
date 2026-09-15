import '@girs/gjs';

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import GdkPixbuf from '@girs/gdkpixbuf-2.0';

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
const THUMBNAIL_SIZE = 640;

export type ClipboardEntry = ClipboardEntrySnapshot;

export function thumbnailPathFor(filePath: string): string {
  return filePath.replace(/\.[^./]+$/, '') + '.thumb.png';
}

function callAsync<T>(
  start: (callback: (_source: unknown, result: Gio.AsyncResult) => void) => void,
  finish: (result: Gio.AsyncResult) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    start((_source, result) => {
      try {
        resolve(finish(result));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export type ClipboardImagePayload = {
  mimeType: string;
  bytes: GLib.Bytes;
  fingerprint: string;
};

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
  private _writeRequestVersion = 0;
  private _clearVersion = 0;
  private _imageCancellable = new Gio.Cancellable();

  constructor(filePath: string, mediaDir: string) {
    this._filePath = filePath;
    this._mediaDir = mediaDir;
  }

  async load(): Promise<void> {
    const clearVersion = this._clearVersion;
    try {
      const file = Gio.File.new_for_path(this._filePath);
      const [contents] = await file.load_contents_async(null);
      const decoded = new TextDecoder().decode(contents);
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
    this._clearVersion++;
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
    const clearVersion = this._clearVersion;
    const filePath = this._mediaDir + '/' + id + this._extensionForMimeType(payload.mimeType);
    const temporaryPath = `${filePath}.${GLib.uuid_string_random()}.tmp`;
    let hasThumbnail = false;
    try {
      await this._writeImage(temporaryPath, payload.bytes);
      await this._validateImageFileAsync(temporaryPath, payload.mimeType);
      const pixbuf = await this._decodeThumbnail(temporaryPath);

      try {
        await this._writeThumbnail(temporaryPath, pixbuf);
        hasThumbnail = true;
      } catch (e) {
        if (this._imageCancellable.is_cancelled()) {
          this._deleteMediaPath(temporaryPath);
          return false;
        }

        logger.warn(
          'Failed to create clipboard image thumbnail:',
          { prefix: LOG_PREFIX },
          e as Error,
        );
      }

      if (this._imageCancellable.is_cancelled() || this._clearVersion !== clearVersion) {
        this._deleteMediaPath(temporaryPath);
        return false;
      }

      if (hasThumbnail) {
        Gio.File.new_for_path(thumbnailPathFor(temporaryPath)).move(
          Gio.File.new_for_path(thumbnailPathFor(filePath)),
          Gio.FileCopyFlags.OVERWRITE,
          this._imageCancellable,
          null,
        );
      }
      Gio.File.new_for_path(temporaryPath).move(
        Gio.File.new_for_path(filePath),
        Gio.FileCopyFlags.OVERWRITE,
        this._imageCancellable,
        null,
      );
    } catch (e) {
      this._deleteMediaPath(temporaryPath);
      if (hasThumbnail) this._deleteMediaPath(filePath);
      if (this._imageCancellable.is_cancelled()) return false;

      logger.warn(
        `Rejected clipboard image: ${payload.mimeType}, ${payload.bytes.get_size()} bytes`,
        { prefix: LOG_PREFIX },
        e as Error,
      );
      return false;
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

  clear(): boolean {
    this._clearVersion++;
    const entries = [...this._pinned, ...this._history];
    if (entries.length === 0) {
      this._compactionRequested = true;
      this._writeRequestVersion++;
      void this._drainWrites();
      return false;
    }

    for (const entry of entries) this._deleteMediaFile(entry);

    this._pinned = [];
    this._history = [];
    this._byId.clear();
    this._byContentKey.clear();
    this._wastedOps += entries.length;
    this._appendLog(entries.map((entry) => encodeDeleteOp(entry.id)).join(''));
    this._requestCompactionIfNeeded();
    return true;
  }

  getPinned(): ClipboardEntry[] {
    return this._pinned;
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
    this._writeRequestVersion++;
    void this._drainWrites();
  }

  private _requestCompactionIfNeeded(): void {
    if (this._wastedOps < MAX_WASTED_OPS) return;
    this._compactionRequested = true;
    this._writeRequestVersion++;
    void this._drainWrites();
  }

  private async _drainWrites(): Promise<void> {
    if (this._writing) return;
    this._writing = true;
    const requestVersion = this._writeRequestVersion;

    try {
      while (this._pendingWrites.length > 0 || this._compactionRequested) {
        if (this._pendingWrites.length > 0) {
          const batch = this._pendingWrites.join('');
          this._pendingWrites = [];
          try {
            await this._appendBatch(batch);
          } catch (e) {
            this._pendingWrites.unshift(batch);
            throw e;
          }
        }

        if (this._compactionRequested) {
          await this._compactLog();
          this._compactionRequested = false;
        }
      }
    } catch (e) {
      logger.error('Failed to write clipboard history log:', { prefix: LOG_PREFIX }, e as Error);
    } finally {
      this._writing = false;
      if (this._writeRequestVersion !== requestVersion) {
        void this._drainWrites();
      }
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
      const bytes = new TextEncoder().encode(data);
      await stream.write_all_async(bytes, WRITE_PRIORITY, null);
      await stream.flush_async(WRITE_PRIORITY, null);
    } finally {
      await stream.close_async(WRITE_PRIORITY, null);
    }
  }

  private async _compactLog(): Promise<void> {
    this._ensureDirectory();
    const entries = [...this._history].reverse().concat([...this._pinned].reverse());
    const data = encodeCompactedLog(entries);
    const bytes = new TextEncoder().encode(data);

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
    const dir = Gio.File.new_for_path(this._filePath).get_parent();
    if (dir && !dir.query_exists(null)) {
      dir.make_directory_with_parents(null);
    }
  }

  private _ensureMediaDirectory(): void {
    GLib.mkdir_with_parents(this._mediaDir, 0o700);
  }

  private async _writeImage(filePath: string, bytes: GLib.Bytes): Promise<void> {
    this._ensureMediaDirectory();
    const file = Gio.File.new_for_path(filePath);
    await callAsync(
      (callback) =>
        file.replace_contents_bytes_async(
          bytes,
          null,
          false,
          Gio.FileCreateFlags.PRIVATE,
          this._imageCancellable,
          callback,
        ),
      (result) => file.replace_contents_finish(result),
    );
  }

  private async _decodeThumbnail(filePath: string): Promise<GdkPixbuf.Pixbuf> {
    const source = Gio.File.new_for_path(filePath);
    const input = await callAsync(
      (callback) => source.read_async(GLib.PRIORITY_DEFAULT, this._imageCancellable, callback),
      (result) => source.read_finish(result),
    );
    return callAsync(
      (callback) =>
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
          input,
          THUMBNAIL_SIZE,
          THUMBNAIL_SIZE,
          true,
          this._imageCancellable,
          callback,
        ),
      (result) => GdkPixbuf.Pixbuf.new_from_stream_finish(result),
    ).finally(() => input.close(null));
  }

  // PNG encoding runs on a GdkPixbuf worker thread.
  private async _writeThumbnail(filePath: string, pixbuf: GdkPixbuf.Pixbuf): Promise<void> {
    const target = Gio.File.new_for_path(thumbnailPathFor(filePath));
    const output = await callAsync(
      (callback) =>
        target.replace_async(
          null,
          false,
          Gio.FileCreateFlags.PRIVATE,
          GLib.PRIORITY_DEFAULT,
          this._imageCancellable,
          callback,
        ),
      (result) => target.replace_finish(result),
    );
    try {
      await callAsync(
        (callback) =>
          pixbuf.save_to_streamv_async(output, 'png', null, null, this._imageCancellable, callback),
        (result) => GdkPixbuf.Pixbuf.save_to_stream_finish(result),
      );
    } finally {
      await output.close_async(GLib.PRIORITY_DEFAULT, this._imageCancellable);
    }
  }

  private _deleteMediaFile(entry: ClipboardEntry): void {
    if (entry.kind !== 'image' || !entry.filePath) return;
    this._deleteMediaPath(entry.filePath);
  }

  private _deleteMediaPath(filePath: string): void {
    for (const path of [filePath, thumbnailPathFor(filePath)]) {
      try {
        Gio.File.new_for_path(path).delete(null);
      } catch (e) {
        if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
          continue;

        logger.warn(`Failed to delete clipboard media: ${path}`, { prefix: LOG_PREFIX }, e);
      }
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
  private async _validateImageFileAsync(filePath: string, mimeType: string): Promise<void> {
    const [format] = await callAsync(
      (callback) =>
        GdkPixbuf.Pixbuf.get_file_info_async(filePath, this._imageCancellable, callback),
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
