import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import type { ClipboardImagePayload } from '~/clipboard/clipboardStore.ts';
import { callAsync } from '~/core/callAsync.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedTimeout } from '~/core/mainLoop.ts';

const LOG_PREFIX = 'ClipboardMonitor';
const CLIPBOARD = Meta.SelectionType.SELECTION_CLIPBOARD;
const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
];
const TEXT_MIME_TYPES = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain', 'STRING'];
const SENSITIVE_MIME_TYPE = 'x-kde-passwordManagerHint';
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_PENDING_BYTES = 128 * 1024 * 1024;
const MAX_PENDING_CAPTURES = 32;
const READ_CHUNK_BYTES = 64 * 1024;
const READ_TIMEOUT_MS = 15_000;

type ClipboardMonitorCallbacks = {
  onText: (text: string) => boolean;
  onImage: (payload: ClipboardImagePayload) => Promise<boolean>;
};

type CaptureDeduplication = { lastContentKey: string | null };

type CaptureRequest = {
  mimeType: string;
  limit: number;
  read: CaptureRead;
  deduplication: CaptureDeduplication;
};

type Capture = Omit<CaptureRequest, 'read'> & {
  bytes: Promise<GLib.Bytes | null>;
  discarded: boolean;
};

type CaptureRead = (
  mimeType: string,
  limit: number,
  cancellable: Gio.Cancellable,
) => Promise<GLib.Bytes>;

export class ClipboardMonitor {
  private _callbacks: ClipboardMonitorCallbacks | null;
  private _lifecycle = new LifecycleScope();
  private _selection: Meta.Selection | null = null;
  private _restoredSource: Meta.SelectionSourceMemory | null = null;
  private _ownerRevision = 0;
  private _deduplication: CaptureDeduplication = { lastContentKey: null };
  private _pendingCaptures: Capture[] = [];
  private _deferredCapture: CaptureRequest | null = null;
  private _reservedBytes = 0;
  private _activeReads = new Set<LifecycleScope>();
  private _persisting = false;
  private _paused = false;

  constructor(callbacks: ClipboardMonitorCallbacks) {
    this._callbacks = callbacks;
  }

  start(storageReady: Promise<void>): void {
    if (this._selection || !this._callbacks) return;

    const selection = global.display.get_selection();
    this._selection = selection;
    this._persisting = true;
    this._lifecycle.connect(
      selection,
      'owner-changed',
      (
        _selection: Meta.Selection,
        selectionType: Meta.SelectionType,
        owner: Meta.SelectionSource | null,
      ) => {
        if (selectionType !== CLIPBOARD) return;

        this._ownerRevision++;
        this._deferredCapture = null;
        if (this._paused || !owner || owner === this._restoredSource) return;

        this._capture(owner.get_mimetypes(), (mimeType, limit, cancellable) =>
          readSource(owner, mimeType, limit, cancellable),
        );
      },
    );

    void storageReady.finally(() => {
      this._persisting = false;
      void this._drainCaptures();
    });
  }

  get ownerRevision(): number {
    return this._ownerRevision;
  }

  discardPendingCaptures(): void {
    this._deduplication = { lastContentKey: null };
    this._deferredCapture = null;
    // Keep reservations until cancelled reads and any in-flight write settle.
    for (const capture of this._pendingCaptures) capture.discarded = true;
    this._cancelReads();
  }

  setPaused(paused: boolean): void {
    this._paused = paused;
    if (paused) this.discardPendingCaptures();
  }

  restoreContent(mimeType: string, bytes: GLib.Bytes): void {
    if (!this._selection) return;

    const source = Meta.SelectionSourceMemory.new(mimeType, bytes);
    // Earlier captures can still complete, but cannot deduplicate across a restore.
    this._deduplication = { lastContentKey: null };
    this._restoredSource = source;
    try {
      this._selection.set_owner(CLIPBOARD, source);
    } finally {
      this._restoredSource = null;
    }
  }

  destroy(): void {
    this._callbacks = null;
    this._selection = null;
    this._lifecycle.dispose();
    this._cancelReads();
    this._pendingCaptures.length = 0;
    this._deferredCapture = null;
  }

  private _cancelReads(): void {
    for (const readScope of this._activeReads) readScope.dispose();
    this._activeReads.clear();
  }

  private _capture(mimeTypes: string[], read: CaptureRead): void {
    if (mimeTypes.includes(SENSITIVE_MIME_TYPE)) return;

    const imageMime = findImageMimeType(mimeTypes);
    const mimeType = imageMime || TEXT_MIME_TYPES.find((type) => mimeTypes.includes(type));
    if (!mimeType) return;

    this._deferredCapture = {
      mimeType,
      limit: imageMime ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES,
      read,
      deduplication: this._deduplication,
    };
    this._admitDeferredCapture();
    void this._drainCaptures();
  }

  private _admitDeferredCapture(): void {
    if (!this._deferredCapture) return;

    if (
      this._pendingCaptures.length >= MAX_PENDING_CAPTURES ||
      this._reservedBytes + this._deferredCapture.limit + 1 > MAX_PENDING_BYTES
    )
      return;

    const { mimeType, limit, read, deduplication } = this._deferredCapture;
    this._deferredCapture = null;
    this._reservedBytes += limit + 1;
    const bytes = this._readWithDeadline((cancellable) => read(mimeType, limit + 1, cancellable));
    this._pendingCaptures.push({ mimeType, limit, deduplication, bytes, discarded: false });
  }

  private async _readWithDeadline(
    read: (cancellable: Gio.Cancellable) => Promise<GLib.Bytes>,
  ): Promise<GLib.Bytes | null> {
    const cancellable = new Gio.Cancellable();
    const readScope = new LifecycleScope();
    const timeout = createManagedTimeout(readScope);
    this._activeReads.add(readScope);
    readScope.onDispose(() => cancellable.cancel());
    timeout.schedule(READ_TIMEOUT_MS, () => cancellable.cancel());
    try {
      const bytes = await read(cancellable);
      return cancellable.is_cancelled() ? null : bytes;
    } catch {
      // The source can disappear or fail to send its data; later captures are still valid.
      return null;
    } finally {
      this._activeReads.delete(readScope);
      readScope.dispose();
    }
  }

  private async _drainCaptures(): Promise<void> {
    if (this._persisting || !this._callbacks) return;

    this._persisting = true;
    try {
      while (this._pendingCaptures[0]) {
        const capture = this._pendingCaptures[0];
        const { mimeType, limit, deduplication } = capture;
        try {
          const bytes = await capture.bytes;
          if (!this._callbacks) return;
          if (capture.discarded || !bytes || bytes.get_size() === 0 || bytes.get_size() > limit)
            continue;

          if (mimeType.startsWith('image/')) {
            const fingerprint = fingerprintBytes(bytes);
            const key = `image:${mimeType}:${fingerprint}`;
            if (
              key !== deduplication.lastContentKey &&
              (await this._callbacks.onImage({ mimeType, bytes, fingerprint }))
            )
              deduplication.lastContentKey = key;
          } else {
            const text = new TextDecoder().decode(bytes.get_data() || new Uint8Array());
            const key = 'text:' + text;
            if (text.trim() && key !== deduplication.lastContentKey && this._callbacks.onText(text))
              deduplication.lastContentKey = key;
          }
        } catch (e) {
          logger.error('Unexpected clipboard persistence failure:', { prefix: LOG_PREFIX }, e);
        } finally {
          this._pendingCaptures.shift();
          this._reservedBytes -= limit + 1;
          this._admitDeferredCapture();
        }
      }
    } finally {
      this._persisting = false;
    }
  }
}

async function readSource(
  owner: Meta.SelectionSource,
  mimeType: string,
  limit: number,
  cancellable: Gio.Cancellable,
): Promise<GLib.Bytes> {
  const input = await callAsync(
    (callback) => owner.read_async(mimeType, cancellable, callback),
    (result) => owner.read_finish(result),
  );
  const output = Gio.MemoryOutputStream.new_resizable();
  try {
    let remaining = limit;
    while (remaining > 0) {
      const chunk = await callAsync(
        (callback) =>
          input.read_bytes_async(
            Math.min(remaining, READ_CHUNK_BYTES),
            GLib.PRIORITY_DEFAULT,
            cancellable,
            callback,
          ),
        (result) => input.read_bytes_finish(result),
      );
      if (chunk.get_size() === 0) break;

      remaining -= output.write_bytes(chunk, cancellable);
    }
  } finally {
    output.close(null);
    input.close(null);
  }
  return output.steal_as_bytes();
}

function findImageMimeType(mimeTypes: string[]): string | null {
  const preferred = IMAGE_MIME_TYPES.find((mimeType) => mimeTypes.includes(mimeType));
  if (preferred) return preferred;

  return mimeTypes.find((mimeType) => mimeType.startsWith('image/')) || null;
}

export function fingerprintBytes(bytes: GLib.Bytes): string {
  return `${bytes.get_size()}-${GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes)}`;
}
