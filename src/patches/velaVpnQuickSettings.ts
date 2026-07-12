import { gettext as _ } from 'gettext';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';

import { logger } from '~/core/logger.ts';
import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';

const LOG_PREFIX = 'VelaVpnQuickSettings';
const VELA_BUS_NAME = 'org.luminusos.Vela.Agent.Vpn1';
const VELA_OBJECT_PATH = '/org/luminusos/Vela/Agent/Vpn1';
const VELA_INTERFACE = 'org.luminusos.Vela.Agent.Vpn1';
const SHELL_FALLBACK_KEY = 'vela-vpn-quick-settings-shell-fallback';

Gio._promisify(Gio.DBusConnection.prototype, 'call');

export class VelaVpnQuickSettings extends Module {
  private _vpnToggle: any = null;
  private _originalActivateConnection: any = null;
  private _originalDeactivateConnection: any = null;
  private _retryId = 0;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._patchWhenAvailable();
  }

  override disable(): void {
    if (this._retryId > 0) {
      GLib.source_remove(this._retryId);
      this._retryId = 0;
    }

    if (this._vpnToggle) {
      if (this._originalActivateConnection)
        this._vpnToggle.activateConnection = this._originalActivateConnection;
      if (this._originalDeactivateConnection)
        this._vpnToggle.deactivateConnection = this._originalDeactivateConnection;
    }

    this._vpnToggle = null;
    this._originalActivateConnection = null;
    this._originalDeactivateConnection = null;
  }

  private _patchWhenAvailable(): void {
    const toggle = this._getVpnToggle();
    if (!toggle) {
      if (this._retryId === 0) {
        this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
          this._retryId = 0;
          this._patchWhenAvailable();
          return GLib.SOURCE_REMOVE;
        });
      }
      return;
    }

    if (this._vpnToggle === toggle) return;

    this.disable();
    this._vpnToggle = toggle;
    this._originalActivateConnection = toggle.activateConnection;
    this._originalDeactivateConnection = toggle.deactivateConnection;

    toggle.activateConnection = (connection: any) => {
      this._setConnectionActive(connection, true, () => {
        this._originalActivateConnection?.call(this._vpnToggle, connection);
      });
    };
    toggle.deactivateConnection = (activeConnection: any) => {
      const connection = activeConnection?.connection ?? activeConnection?.get_connection?.();
      this._setConnectionActive(connection, false, () => {
        this._originalDeactivateConnection?.call(this._vpnToggle, activeConnection);
      });
    };

    logger.info('Routing VPN Quick Settings activation through Vela', { prefix: LOG_PREFIX });
  }

  private _setConnectionActive(connection: any, active: boolean, fallback?: () => void): void {
    const path = connection?.get_path?.();
    if (!path) {
      logger.warn('Cannot route VPN activation without a NetworkManager connection path', {
        prefix: LOG_PREFIX,
      });
      if (this.context.settings.getBoolean(SHELL_FALLBACK_KEY)) fallback?.();
      return;
    }

    this._callVelaSetConnectionActive(path, active).catch((error) => {
      const remoteErrorName = this._getRemoteDbusErrorName(error);
      logger.warn(
        `Vela VPN control API failed (${remoteErrorName ?? 'local error'}): ${String(error)}`,
        { prefix: LOG_PREFIX },
      );
      if (!this.context.settings.getBoolean(SHELL_FALLBACK_KEY)) return;
      if (!this._shouldFallbackToShell(remoteErrorName)) return;

      logger.info(`Using GNOME Shell fallback after ${remoteErrorName}`, { prefix: LOG_PREFIX });
      fallback?.();
    });
  }

  private async _callVelaSetConnectionActive(
    connectionPath: string,
    active: boolean,
  ): Promise<void> {
    await (Gio.DBus.session as any).call(
      VELA_BUS_NAME,
      VELA_OBJECT_PATH,
      VELA_INTERFACE,
      'SetConnectionActive',
      new GLib.Variant('(ob)', [connectionPath, active]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
    );
  }

  private _getRemoteDbusErrorName(error: unknown): string | null {
    if (!(error instanceof GLib.Error)) return null;
    return Gio.DBusError.get_remote_error(error);
  }

  private _shouldFallbackToShell(remoteErrorName: string | null): boolean {
    switch (remoteErrorName) {
      case 'org.freedesktop.DBus.Error.ServiceUnknown':
      case 'org.freedesktop.DBus.Error.NameHasNoOwner':
      case 'org.freedesktop.DBus.Error.UnknownMethod':
      case 'org.freedesktop.DBus.Error.UnknownObject':
      case 'org.freedesktop.DBus.Error.UnknownInterface':
        return true;
      default:
        return false;
    }
  }

  private _getNetworkIndicator(): any {
    const statusArea = (Main.panel as any).statusArea;
    return statusArea.quickSettings?._network ?? statusArea.aggregateMenu?._network ?? null;
  }

  private _getVpnToggle(): any {
    return this._getNetworkIndicator()?._vpnToggle ?? null;
  }
}
