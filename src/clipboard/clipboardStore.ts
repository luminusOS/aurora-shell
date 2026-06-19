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
} from '~/clipboard/clipboardLog.ts';

// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_contents_async');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'append_to_async', 'append_to_finish');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.OutputStream.prototype, 'flush_async', 'flush_finish');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');

const LOG_PREFIX = 'ClipboardHistory';
const WRITE_PRIORITY = GLib.PRIORITY_DEFAULT_IDLE;
const MAX_WASTED_OPS = 500;

export type ClipboardEntry = {
  id: string;
  kind: 'text' | 'image';
  text: string;
  pinned: boolean;
  timestamp: number;
  mimeType?: string;
  filePath?: string;
  contentKey: string;
};

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

  constructor(filePath: string, mediaDir: string) {
    this._filePath = filePath;
    this._mediaDir = mediaDir;
  }

  async load(): Promise<void> {
    try {
      const file = Gio.File.new_for_path(this._filePath);
      const [contents] = await file.load_contents_async(null);
      const decoded = new TextDecoder().decode(contents);
      const state = parseClipboardLog(decoded);
      const { pinned, history, removed } = this._dropInvalidImageEntries(
        state.pinned,
        state.history,
      );

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

    try {
      _validateImageBytes(payload.mimeType, payload.bytes);
    } catch (e) {
      logger.warn(
        `Rejected invalid clipboard image: ${payload.mimeType}, ${payload.bytes.get_size()} bytes`,
        { prefix: LOG_PREFIX },
        e as Error,
      );
      return false;
    }

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
    const filePath = this._mediaDir + '/' + id + _extensionForMimeType(payload.mimeType);
    await this._writeImage(filePath, payload.bytes);

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

    this._removeFromList(this._history, entry);
    entry.pinned = true;
    this._pinned.unshift(entry);
    this._appendLog(encodePinOp(id));
  }

  unpin(id: string): void {
    const entry = this._byId.get(id);
    if (!entry || !entry.pinned) return;

    this._removeFromList(this._pinned, entry);
    entry.pinned = false;
    this._history.unshift(entry);
    this._wastedOps += 2;
    this._appendLog(encodeUnpinOp(id));
    this._requestCompactionIfNeeded();
  }

  remove(id: string): void {
    const entry = this._byId.get(id);
    if (!entry) return;

    this._removeFromList(this._pinned, entry);
    this._removeFromList(this._history, entry);
    this._byId.delete(id);
    this._byContentKey.delete(entry.contentKey);
    this._deleteMediaFile(entry);
    this._wastedOps += entry.pinned ? 3 : 2;
    this._appendLog(encodeDeleteOp(id));
    this._requestCompactionIfNeeded();
  }

  clear(): boolean {
    const entries = [...this._pinned, ...this._history];
    if (entries.length === 0) return false;

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
    return this._pinned.filter((e) => _searchText(e).includes(q));
  }

  filterHistory(query: string): ClipboardEntry[] {
    if (!query) return this._history;
    const q = query.toLowerCase();
    return this._history.filter((e) => _searchText(e).includes(q));
  }

  private _moveToFront(entry: ClipboardEntry): void {
    const list = entry.pinned ? this._pinned : this._history;
    this._removeFromList(list, entry);
    list.unshift(entry);
  }

  private _removeFromList(list: ClipboardEntry[], entry: ClipboardEntry): void {
    const index = list.indexOf(entry);
    if (index !== -1) list.splice(index, 1);
  }

  private _rebuildIndexes(): void {
    this._byId.clear();
    this._byContentKey.clear();
    for (const entry of [...this._pinned, ...this._history]) {
      entry.kind ??= 'text';
      entry.contentKey ??= entry.kind === 'image' ? 'image:' + entry.id : 'text:' + entry.text;
      this._byId.set(entry.id, entry);
      this._byContentKey.set(entry.contentKey, entry);
    }
  }

  private _dropInvalidImageEntries(
    pinned: ClipboardEntry[],
    history: ClipboardEntry[],
  ): { pinned: ClipboardEntry[]; history: ClipboardEntry[]; removed: number } {
    let removed = 0;

    const keepValid = (entry: ClipboardEntry): boolean => {
      if (entry.kind !== 'image') return true;

      try {
        _validateImageFile(entry);
        return true;
      } catch (e) {
        removed++;
        logger.warn(
          `Dropped invalid clipboard image from history: id=${entry.id}, path=${entry.filePath ?? '(none)'}`,
          { prefix: LOG_PREFIX },
          e as Error,
        );
        this._deleteMediaFile(entry);
        return false;
      }
    };

    return {
      pinned: pinned.filter(keepValid),
      history: history.filter(keepValid),
      removed,
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
    if (this._writing) return;
    this._writing = true;

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
          this._compactionRequested = false;
          await this._compactLog();
        }
      }
    } catch (e) {
      logger.error('Failed to write clipboard history log:', { prefix: LOG_PREFIX }, e as Error);
    } finally {
      this._writing = false;
      if (this._pendingWrites.length > 0 || this._compactionRequested) {
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
      await stream.write_bytes_async(bytes, WRITE_PRIORITY, null);
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
    await Gio.File.new_for_path(filePath).replace_contents_async(
      bytes.toArray(),
      null,
      false,
      Gio.FileCreateFlags.PRIVATE,
      null,
    );
  }

  private _deleteMediaFile(entry: ClipboardEntry): void {
    if (entry.kind !== 'image' || !entry.filePath) return;

    try {
      const file = Gio.File.new_for_path(entry.filePath);
      if (file.query_exists(null)) file.delete(null);
    } catch (_e) {
      // Runtime files are session-scoped; deletion here is best effort.
    }
  }
}

function _extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/bmp') return '.bmp';
  if (mimeType === 'image/tiff') return '.tiff';
  return '.png';
}

function _validateImageBytes(mimeType: string, bytes: GLib.Bytes): void {
  let loader: GdkPixbuf.PixbufLoader | null = null;

  try {
    loader = GdkPixbuf.PixbufLoader.new_with_mime_type(mimeType);
    loader.write_bytes(bytes);
    loader.close();

    if (!loader.get_pixbuf() && !loader.get_animation()) {
      throw new Error('Image decoder did not produce a pixbuf or animation');
    }
  } catch (e) {
    if (loader) {
      try {
        loader.close();
      } catch (_closeError) {
        // The original decoder error is the useful one.
      }
    }
    throw e;
  }
}

function _validateImageFile(entry: ClipboardEntry): void {
  if (!entry.filePath) throw new Error('Image entry has no file path');

  const file = Gio.File.new_for_path(entry.filePath);
  if (!file.query_exists(null)) throw new Error('Image file is missing');

  GdkPixbuf.Pixbuf.new_from_file(entry.filePath);
}

function _searchText(entry: ClipboardEntry): string {
  if (entry.kind === 'image') return 'image imagem picture photo foto';
  return entry.text.toLowerCase();
}
