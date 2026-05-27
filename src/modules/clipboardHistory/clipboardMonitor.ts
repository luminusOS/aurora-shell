import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';

export class ClipboardMonitor {
  private _intervalMs: number;
  private _onText: (text: string) => void;
  private _sourceId: number = 0;

  constructor(intervalMs: number, onText: (text: string) => void) {
    this._intervalMs = intervalMs;
    this._onText = onText;
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
    St.Clipboard.get_default().get_text(
      St.ClipboardType.CLIPBOARD,
      (_clipboard: St.Clipboard, text: string | null) => {
        if (text && text.trim().length > 0) {
          this._onText(text);
        }
      },
    );
  }
}
