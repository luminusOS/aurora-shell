import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Meta from '@girs/meta-18';
import St from '@girs/st-18';

import type { ClipboardImagePayload } from '~/clipboard/clipboardStore.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedTimeout } from '~/core/mainLoop.ts';

const LOG_PREFIX = 'ClipboardMonitor';
const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
];
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const READ_DELAY_MS = 50;

type ClipboardMonitorCallbacks = {
  onText: (text: string) => void;
  onImage: (payload: ClipboardImagePayload) => Promise<unknown>;
};

export class ClipboardMonitor {
  private _callbacks: ClipboardMonitorCallbacks | null;
  private _lifecycle = new LifecycleScope();
  private _readTimeout = createManagedTimeout(this._lifecycle);
  private _cancellable = new Gio.Cancellable();
  private _lastContentKey: string | null = null;
  private _started = false;
  private _suppressNextOwnerChange = false;
  private _readInProgress = false;
  private _readPending = false;

  constructor(callbacks: ClipboardMonitorCallbacks) {
    this._callbacks = callbacks;
  }

  start(): void {
    if (this._started || !this._callbacks) return;
    this._started = true;

    this._lifecycle.connect(
      global.display.get_selection(),
      'owner-changed',
      (_selection, selectionType) => {
        if (selectionType !== Meta.SelectionType.SELECTION_CLIPBOARD) return;
        if (this._suppressNextOwnerChange) {
          this._suppressNextOwnerChange = false;
          return;
        }
        // owner-changed is emitted synchronously from inside set_content (e.g. while the
        // screenshot UI still holds its grab), and reading a shell-owned source copies the
        // whole payload in mutter. Defer, and coalesce bursts of owner changes.
        this._readTimeout.schedule(READ_DELAY_MS, () => this._requestRead());
      },
    );
    this._requestRead();
  }

  // Call right before setting the clipboard ourselves: the owner-changed it emits is
  // synchronous, so the flag is consumed by exactly that change.
  suppressNextOwnerChange(): void {
    this._readTimeout.clear();
    this._readPending = false;
    this._suppressNextOwnerChange = true;
  }

  destroy(): void {
    this._callbacks = null;
    this._cancellable.cancel();
    this._lifecycle.dispose();
  }

  private _requestRead(): void {
    if (!this._callbacks) return;
    if (this._readInProgress) {
      this._readPending = true;
      return;
    }

    this._readInProgress = true;
    this._readClipboard();
  }

  private _readClipboard(): void {
    const clipboard = St.Clipboard.get_default();
    const imageMimeType = findImageMimeType(clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD));
    if (imageMimeType) {
      this._readImage(imageMimeType);
      return;
    }

    clipboard.get_text(
      St.ClipboardType.CLIPBOARD,
      (_clipboard: St.Clipboard, text: string | null) => {
        try {
          if (!this._callbacks || !text || text.trim().length === 0) return;

          const contentKey = 'text:' + text;
          if (contentKey === this._lastContentKey) return;

          this._lastContentKey = contentKey;
          this._callbacks.onText(text);
        } finally {
          this._finishRead();
        }
      },
    );
  }

  // Not St.Clipboard.get_content(): its callback receives a transfer-none GBytes that GJS
  // wraps without taking a reference (Boxed::NoCopy) and St unrefs right after the callback.
  // When the wrapper is later finalized, GJS removes g_bytes_get_size() of the freed GBytes
  // from SpiderMonkey's malloc accounting; reading reused memory underflows the counter to
  // ~2^64 and every later JS allocation then triggers a full GC, crippling the shell for the
  // rest of the session. Transferring into our own stream yields an owned GBytes instead.
  private _readImage(mimeType: string): void {
    const selection = global.display.get_selection();
    const stream = Gio.MemoryOutputStream.new_resizable();
    selection.transfer_async(
      Meta.SelectionType.SELECTION_CLIPBOARD,
      mimeType,
      MAX_IMAGE_BYTES + 1,
      stream,
      this._cancellable,
      (_selection, result) => {
        try {
          selection.transfer_finish(result);
        } catch {
          // Cancelled on destroy, or the owner vanished mid-transfer; the next owner-changed
          // reads again.
          this._finishRead();
          return;
        }

        let persistenceStarted = false;
        try {
          if (!stream.is_closed()) stream.close(null);
          const bytes = stream.steal_as_bytes();
          const size = bytes.get_size();
          if (!this._callbacks || size === 0 || size > MAX_IMAGE_BYTES) return;

          const fingerprint = fingerprintBytes(bytes);
          const contentKey = 'image:' + mimeType + ':' + fingerprint;
          if (contentKey === this._lastContentKey) return;

          this._lastContentKey = contentKey;
          persistenceStarted = true;
          void this._persistImage(this._callbacks, { mimeType, bytes, fingerprint });
        } finally {
          if (!persistenceStarted) this._finishRead();
        }
      },
    );
  }

  private async _persistImage(
    callbacks: ClipboardMonitorCallbacks,
    payload: ClipboardImagePayload,
  ): Promise<void> {
    try {
      await callbacks.onImage(payload);
    } catch (e) {
      logger.error('Unexpected clipboard image persistence failure:', { prefix: LOG_PREFIX }, e);
    } finally {
      this._finishRead();
    }
  }

  private _finishRead(): void {
    this._readInProgress = false;
    if (!this._readPending || !this._callbacks) return;

    this._readPending = false;
    this._requestRead();
  }
}

function findImageMimeType(mimeTypes: string[]): string | null {
  const preferred = IMAGE_MIME_TYPES.find((mimeType) => mimeTypes.includes(mimeType));
  if (preferred) return preferred;

  return mimeTypes.find((mimeType) => mimeType.startsWith('image/')) || null;
}

export function fingerprintBytes(bytes: GLib.Bytes): string {
  return `${bytes.get_size()}-${GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes)}`;
}
