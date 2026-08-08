import { gettext as _ } from '~/shared/i18n.ts';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';

import { logger } from '~/core/logger.ts';
import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
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
  private _installedActivateConnection: any = null;
  private _installedDeactivateConnection: any = null;
  private _lifecycle: LifecycleScope | null = null;
  private _retry: ManagedSource | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._lifecycle = new LifecycleScope();
    this._retry = createManagedSource(this._lifecycle);
    this._patchWhenAvailable();
  }

  override disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._retry = null;
    this._restorePatch();
  }

  private _restorePatch(): void {
    if (this._vpnToggle) {
      if (this._vpnToggle.activateConnection === this._installedActivateConnection) {
        this._vpnToggle.activateConnection = this._originalActivateConnection;
      }
      if (this._vpnToggle.deactivateConnection === this._installedDeactivateConnection) {
        this._vpnToggle.deactivateConnection = this._originalDeactivateConnection;
      }
    }

    this._vpnToggle = null;
    this._originalActivateConnection = null;
    this._originalDeactivateConnection = null;
    this._installedActivateConnection = null;
    this._installedDeactivateConnection = null;
  }

  private _patchWhenAvailable(): void {
    if (!this._retry) return;

    const toggle = this._getVpnToggle();
    if (!toggle) {
      if (!this._retry.active) {
        this._retry.replace(() =>
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._retry!.complete();
            this._patchWhenAvailable();
            return GLib.SOURCE_REMOVE;
          }),
        );
      }
      return;
    }

    if (this._vpnToggle === toggle) return;

    this._restorePatch();
    this._vpnToggle = toggle;
    const originalActivateConnection = toggle.activateConnection;
    const originalDeactivateConnection = toggle.deactivateConnection;
    this._originalActivateConnection = originalActivateConnection;
    this._originalDeactivateConnection = originalDeactivateConnection;

    const installedActivateConnection = (connection: any) => {
      this._setConnectionActive(connection, true, () => {
        if (this._vpnToggle === toggle) {
          originalActivateConnection.call(toggle, connection);
        }
      });
    };
    const installedDeactivateConnection = (activeConnection: any) => {
      const connection = activeConnection.connection;
      this._setConnectionActive(connection, false, () => {
        if (this._vpnToggle === toggle) {
          originalDeactivateConnection.call(toggle, activeConnection);
        }
      });
    };
    this._installedActivateConnection = installedActivateConnection;
    this._installedDeactivateConnection = installedDeactivateConnection;
    toggle.activateConnection = installedActivateConnection;
    toggle.deactivateConnection = installedDeactivateConnection;

    logger.log('Routing VPN Quick Settings activation through Vela', { prefix: LOG_PREFIX });
  }

  private _setConnectionActive(connection: any, active: boolean, fallback: () => void): void {
    const path = connection.get_path();
    if (!path) {
      logger.warn('Cannot route VPN activation without a NetworkManager connection path', {
        prefix: LOG_PREFIX,
      });
      if (this.context.settings.getBoolean(SHELL_FALLBACK_KEY)) fallback();
      return;
    }

    this._callVelaSetConnectionActive(path, active).catch((error) => {
      const remoteErrorName = this._getRemoteDbusErrorName(error);
      logger.warn(
        `Vela VPN control API failed (${remoteErrorName || 'local error'}): ${String(error)}`,
        { prefix: LOG_PREFIX },
      );
      if (!this.context.settings.getBoolean(SHELL_FALLBACK_KEY)) return;
      if (!this._shouldFallbackToShell(remoteErrorName)) return;

      logger.log(`Using GNOME Shell fallback after ${remoteErrorName}`, { prefix: LOG_PREFIX });
      fallback();
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
    if (!statusArea.quickSettings) return null;

    const networkIndicator = statusArea.quickSettings._network;
    if (!networkIndicator) return null;

    return networkIndicator;
  }

  private _getVpnToggle(): any {
    const indicator = this._getNetworkIndicator();
    if (!indicator) return null;

    return indicator._vpnToggle;
  }
}
