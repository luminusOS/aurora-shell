import '@girs/gjs';

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';

import { logger } from '~/core/logger.ts';

// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_contents_async');

const LOG_PREFIX = 'ClipboardHistory';

export type ClipboardEntry = {
  id: string;
  text: string;
  pinned: boolean;
  timestamp: number;
};

type StorageFormat = {
  version: 1;
  entries: ClipboardEntry[];
};

export class ClipboardStore {
  private _pinned: ClipboardEntry[] = [];
  private _history: ClipboardEntry[] = [];
  private _maxItems: number;
  private _filePath: string;
  private _saveTimerId: number = 0;

  constructor(filePath: string, maxItems: number) {
    this._filePath = filePath;
    this._maxItems = maxItems;
  }

  async load(): Promise<void> {
    try {
      const file = Gio.File.new_for_path(this._filePath);
      const [contents] = await file.load_contents_async(null);
      const decoded = new TextDecoder().decode(contents);
      const parsed = JSON.parse(decoded) as StorageFormat;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
      this._pinned = parsed.entries.filter((e) => e.pinned);
      this._history = parsed.entries.filter((e) => !e.pinned).slice(0, this._maxItems);
    } catch (_e) {
      this._pinned = [];
      this._history = [];
    }
  }

  save(): void {
    if (this._saveTimerId !== 0) {
      GLib.source_remove(this._saveTimerId);
      this._saveTimerId = 0;
    }
    this._doSave();
  }

  addText(text: string): boolean {
    if (!text.trim()) return false;
    if (this._history.length > 0 && this._history[0]!.text === text) return false;
    const entry: ClipboardEntry = {
      id: String(GLib.get_monotonic_time()),
      text,
      pinned: false,
      timestamp: Date.now(),
    };
    this._history.unshift(entry);
    if (this._history.length > this._maxItems) {
      this._history.length = this._maxItems;
    }
    this._schedSave();
    return true;
  }

  pin(id: string): void {
    const idx = this._history.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const removed = this._history.splice(idx, 1)[0]!;
    removed.pinned = true;
    this._pinned.unshift(removed);
    this._schedSave();
  }

  unpin(id: string): void {
    const idx = this._pinned.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const removed = this._pinned.splice(idx, 1)[0]!;
    removed.pinned = false;
    if (this._history.length === 0 || this._history[0]!.text !== removed.text) {
      this._history.unshift(removed);
      if (this._history.length > this._maxItems) {
        this._history.length = this._maxItems;
      }
    }
    this._schedSave();
  }

  remove(id: string): void {
    const histIdx = this._history.findIndex((e) => e.id === id);
    if (histIdx !== -1) {
      this._history.splice(histIdx, 1);
      this._schedSave();
      return;
    }
    const pinIdx = this._pinned.findIndex((e) => e.id === id);
    if (pinIdx !== -1) {
      this._pinned.splice(pinIdx, 1);
      this._schedSave();
    }
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
    return this._pinned.filter((e) => e.text.toLowerCase().includes(q));
  }

  filterHistory(query: string): ClipboardEntry[] {
    if (!query) return this._history;
    const q = query.toLowerCase();
    return this._history.filter((e) => e.text.toLowerCase().includes(q));
  }

  setMaxItems(n: number): void {
    this._maxItems = n;
    if (this._history.length > n) {
      this._history.length = n;
      this._schedSave();
    }
  }

  private _schedSave(): void {
    if (this._saveTimerId !== 0) {
      GLib.source_remove(this._saveTimerId);
    }
    this._saveTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 300, () => {
      this._saveTimerId = 0;
      this._doSave();
      return GLib.SOURCE_REMOVE;
    });
  }

  private _doSave(): void {
    try {
      const file = Gio.File.new_for_path(this._filePath);
      const dir = file.get_parent();
      if (dir && !dir.query_exists(null)) {
        dir.make_directory_with_parents(null);
      }
      const store: StorageFormat = {
        version: 1,
        entries: [...this._pinned, ...this._history],
      };
      const data = JSON.stringify(store, null, 2);
      const bytes = new TextEncoder().encode(data) as unknown as Uint8Array;
      file.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (e) {
      logger.error('Failed to save clipboard history:', { prefix: LOG_PREFIX }, e as Error);
    }
  }
}
