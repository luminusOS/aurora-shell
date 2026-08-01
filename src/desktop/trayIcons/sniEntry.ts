import Gio from '@girs/gio-2.0';
import type { TrayItem } from './trayState.ts';

export class SniEntry {
  constructor(
    public readonly proxy: Gio.DBusProxy,
    public readonly item: TrayItem,
    public readonly sniId: string,
    public readonly desktopEntry: string,
    private _signalId: number,
    private _nameWatchId: number,
    private _cancellable: Gio.Cancellable,
  ) {}

  destroy(): void {
    this._cancellable.cancel();

    if (this._signalId) {
      this.proxy.disconnect(this._signalId);
    }

    if (this._nameWatchId) {
      Gio.DBus.session.unwatch_name(this._nameWatchId);
    }

    this._signalId = 0;
    this._nameWatchId = 0;
  }
}
