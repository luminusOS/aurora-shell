import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';

import type { ClipboardImagePayload } from '~/clipboard/clipboardStore.ts';

const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
];

export class ClipboardMonitor {
  private _intervalMs: number;
  private _onText: (text: string) => void;
  private _onImage: (payload: ClipboardImagePayload) => void;
  private _sourceId: number = 0;
  private _lastContentKey: string | null = null;

  constructor(
    intervalMs: number,
    callbacks: {
      onText: (text: string) => void;
      onImage: (payload: ClipboardImagePayload) => void;
    },
  ) {
    this._intervalMs = intervalMs;
    this._onText = callbacks.onText;
    this._onImage = callbacks.onImage;
  }

  start(): void {
    if (this._sourceId !== 0) return;
    this._sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._intervalMs, () => {
      this._tick();
      return GLib.SOURCE_CONTINUE;
    });
  }

  stop(): void {
    if (this._sourceId !== 0) {
      GLib.source_remove(this._sourceId);
      this._sourceId = 0;
    }
  }

  setInterval(ms: number): void {
    this._intervalMs = ms;
    if (this._sourceId !== 0) {
      this.stop();
      this.start();
    }
  }

  private _tick(): void {
    const clipboard = St.Clipboard.get_default();
    const imageMimeType = _findImageMimeType(clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD));

    if (imageMimeType) {
      clipboard.get_content(St.ClipboardType.CLIPBOARD, imageMimeType, (_clipboard, bytes) => {
        if (!bytes || bytes.get_size() === 0) return;

        const fingerprint = fingerprintBytes(bytes);
        const contentKey = 'image:' + imageMimeType + ':' + fingerprint;
        if (contentKey === this._lastContentKey) return;

        this._lastContentKey = contentKey;
        this._onImage({ mimeType: imageMimeType, bytes, fingerprint });
      });
      return;
    }

    clipboard.get_text(
      St.ClipboardType.CLIPBOARD,
      (_clipboard: St.Clipboard, text: string | null) => {
        if (!text || text.trim().length === 0) return;

        const contentKey = 'text:' + text;
        if (contentKey === this._lastContentKey) return;

        this._lastContentKey = contentKey;
        this._onText(text);
      },
    );
  }
}

function _findImageMimeType(mimeTypes: string[]): string | null {
  for (const preferred of IMAGE_MIME_TYPES) {
    if (mimeTypes.includes(preferred)) return preferred;
  }

  return mimeTypes.find((mimeType) => mimeType.startsWith('image/')) ?? null;
}

export function fingerprintBytes(bytes: GLib.Bytes): string {
  const data = bytes.toArray();
  let hash = 2166136261;

  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]!;
    hash = Math.imul(hash, 16777619);
  }

  return data.length + '-' + (hash >>> 0).toString(16);
}
