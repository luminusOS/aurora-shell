// src/modules/trayIcons/backgroundAppsSource.ts
import '@girs/gjs';
import { gettext as _ } from 'gettext';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Shell from '@girs/shell-18';

import type { TrayItem, TrayItemStatus } from './trayState.ts';
import { logger } from '~/core/logger.ts';

const DBUS_NAME = 'org.freedesktop.background.Monitor';
const DBUS_OBJECT = '/org/freedesktop/background/monitor';
const LOG_PREFIX = 'AuroraTray';

const BACKGROUND_MONITOR_XML = `
<node>
  <interface name="org.freedesktop.background.Monitor">
    <property name="BackgroundApps" type="aa{sv}" access="read"/>
    <property name="version" type="u" access="read"/>
  </interface>
</node>`;

const BackgroundMonitorProxy = Gio.DBusProxy.makeProxyWrapper(BACKGROUND_MONITOR_XML);

// @ts-ignore — _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.DBusConnection.prototype, 'call');

type Callbacks = {
  onItemAdded(item: TrayItem): void;
  onItemRemoved(id: string): void;
};

export class BackgroundAppsSource {
  private _proxy: Gio.DBusProxy | null = null;
  private _cancellable: Gio.Cancellable | null = null;
  private _knownIds = new Map<string, TrayItem>();
  private _proxyChangedId = 0;
  private _callbacks: Callbacks;
  private _appSystem: Shell.AppSystem | null;
  constructor(callbacks: Callbacks) {
    this._callbacks = callbacks;
    this._appSystem = Shell.AppSystem.get_default();
  }

  async start(): Promise<void> {
    this._cancellable = new Gio.Cancellable();
    try {
      this._proxy = new (BackgroundMonitorProxy as any)(
        Gio.DBus.session,
        DBUS_NAME,
        DBUS_OBJECT,
        this._cancellable,
      ) as Gio.DBusProxy;

      this._proxyChangedId = this._proxy.connect('g-properties-changed', () => this._sync());
      this._sync();
    } catch (e) {
      if (!(e as any)?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        logger.warn(`BackgroundApps proxy unavailable: ${e}`, { prefix: LOG_PREFIX });
      }
      this._proxy = null;
    }
  }

  private _sync(): void {
    if (!this._proxy || !this._appSystem) return;

    const backgroundApps = (this._proxy as any).BackgroundApps;
    const currentApps = new Map<string, { app: Shell.App; message: string | null }>();

    if (backgroundApps) {
      // GJS might have already unpacked the aa{sv} into an array of objects
      const apps = Array.isArray(backgroundApps) ? backgroundApps : [];

      for (const appData of apps) {
        if (!appData || typeof appData !== 'object') continue;

        // makeProxyWrapper unpacks aa{sv} to JS array of objects, but each
        // value in the a{sv} dict is still a GLib.Variant (the 'v' box is not
        // unwrapped). Handle both that case and fully-unpacked plain strings.
        const dict: Record<string, unknown> =
          appData instanceof GLib.Variant
            ? (appData.deep_unpack() as Record<string, unknown>)
            : (appData as Record<string, unknown>);

        const unpackStr = (val: unknown): string | undefined => {
          if (val instanceof GLib.Variant) return val.unpack() as string;
          if (typeof val === 'string') return val;
          return undefined;
        };

        const appId = unpackStr(dict['app_id']);
        const message = unpackStr(dict['message']) ?? null;

        if (!appId) continue;

        const app = this._appSystem.lookup_app(`${appId}.desktop`);
        if (!app) continue;
        if (currentApps.has(appId)) continue;
        currentApps.set(appId, { app, message });
      }
    }

    // Remove gone apps
    for (const [id] of this._knownIds) {
      if (!currentApps.has(id)) {
        logger.log(`BG app removed from monitor: ${id}`, { prefix: LOG_PREFIX });
        this._knownIds.delete(id);
        this._callbacks.onItemRemoved(`bg:${id}`);
      }
    }

    // Add new apps
    for (const [appId, { app, message }] of currentApps) {
      if (!this._knownIds.has(appId)) {
        logger.log(`BG app found in monitor: ${appId}`, { prefix: LOG_PREFIX });
        const item = this._makeItem(appId, app, message);
        this._knownIds.set(appId, item);
        this._callbacks.onItemAdded(item);
      }
    }
  }

  private _makeItem(appId: string, app: Shell.App, message: string | null): TrayItem {
    return {
      id: `bg:${appId}`,
      get icon() {
        return app.get_icon() ?? 'application-x-executable-symbolic';
      },
      get tooltip() {
        return message ?? '';
      },
      get status(): TrayItemStatus {
        return 'Active';
      },
      activate(_x: number, _y: number) {
        app.activate();
      },
      menuItems: [
        { label: _('Open'), action: () => app.activate() },
        { label: _('Quit'), action: () => app.request_quit() },
      ],
      destroy() {},
    };
  }

  destroy(): void {
    this._cancellable?.cancel();
    this._cancellable = null;
    if (this._proxy && this._proxyChangedId) {
      this._proxy.disconnect(this._proxyChangedId);
      this._proxyChangedId = 0;
    }
    this._proxy = null;
    this._appSystem = null;
    this._knownIds.clear();
  }
}
