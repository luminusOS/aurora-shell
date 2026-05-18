// src/modules/trayIcons/sniWatcher.ts
import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import type { Logger } from '~/core/logger.ts';

export const SNI_WATCHER_BUS_NAME = 'org.kde.StatusNotifierWatcher';
const SNI_WATCHER_OBJECT = '/StatusNotifierWatcher';
const SNI_DEFAULT_ITEM_PATH = '/StatusNotifierItem';

const WATCHER_XML = `
<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem">
      <arg name="service" type="s" direction="in"/>
    </method>
    <method name="RegisterStatusNotifierHost">
      <arg name="service" type="s" direction="in"/>
    </method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
    <signal name="StatusNotifierItemUnregistered"><arg type="s"/></signal>
    <signal name="StatusNotifierHostRegistered"/>
  </interface>
</node>`;

export type SniRegisteredCallback = (busName: string, objectPath: string) => void;
export type SniUnregisteredCallback = (busName: string, objectPath: string) => void;

export class SniWatcher {
  private _dbusImpl: Gio.DBusExportedObject | null = null;
  private _ownNameId = 0;
  private _failed = false;
  private _registeredItems: string[] = [];
  private _onItemRegistered: SniRegisteredCallback;
  private _onItemUnregistered: SniUnregisteredCallback;
  private _logger: Logger;

  constructor(
    logger: Logger,
    onItemRegistered: SniRegisteredCallback,
    onItemUnregistered: SniUnregisteredCallback,
  ) {
    this._logger = logger;
    this._onItemRegistered = onItemRegistered;
    this._onItemUnregistered = onItemUnregistered;
  }

  start(): void {
    this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(WATCHER_XML, this);

    try {
      this._dbusImpl.export(Gio.DBus.session, SNI_WATCHER_OBJECT);
    } catch (e) {
      this._logger.warn(`[aurora-tray] Failed to export SNI watcher object: ${e}`);
      this._failed = true;
      return;
    }

    this._ownNameId = Gio.DBus.session.own_name(
      SNI_WATCHER_BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      // GJS accepts plain functions here; types expect GObject.Closure
      (() => {
        this._logger.info('[aurora-tray] Acquired org.kde.StatusNotifierWatcher');
        try {
          this._dbusImpl?.emit_signal('StatusNotifierHostRegistered', new GLib.Variant('()', []));
        } catch {
          // signal emission may fail if unexported
        }
      }) as unknown as never,
      (() => {
        this._logger.warn(
          '[aurora-tray] org.kde.StatusNotifierWatcher already owned by another process. SNI icons disabled.',
        );
        this._failed = true;
      }) as unknown as never,
    );
  }

  // DBus method: called by SNI apps when they start
  RegisterStatusNotifierItem(service: string): void {
    if (this._failed) return;

    let busName: string;
    let objectPath: string;

    if (service.startsWith('/')) {
      // Cannot resolve sender bus name from wrapJSObject — skip bare object path registrations.
      // Modern SNI apps use "busName" or "busName/objectPath" format.
      this._logger.warn(
        `[aurora-tray] Ignoring SNI registration with bare object path: ${service}`,
      );
      return;
    } else if (service.includes('/')) {
      const slashIdx = service.indexOf('/');
      busName = service.substring(0, slashIdx);
      objectPath = service.substring(slashIdx);
    } else {
      busName = service;
      objectPath = SNI_DEFAULT_ITEM_PATH;
    }

    const id = `${busName}${objectPath}`;
    if (this._registeredItems.includes(id)) return;
    this._registeredItems.push(id);

    try {
      this._dbusImpl?.emit_signal('StatusNotifierItemRegistered', new GLib.Variant('(s)', [id]));
    } catch {
      // signal emission may fail if unexported
    }

    this._onItemRegistered(busName, objectPath);
  }

  // DBus method: called by SNI hosts
  RegisterStatusNotifierHost(_service: string): void {
    try {
      this._dbusImpl?.emit_signal('StatusNotifierHostRegistered', new GLib.Variant('()', []));
    } catch {
      // signal emission may fail if unexported
    }
  }

  // DBus property
  get RegisteredStatusNotifierItems(): string[] {
    return this._registeredItems;
  }

  get IsStatusNotifierHostRegistered(): boolean {
    return !this._failed;
  }

  get ProtocolVersion(): number {
    return 0;
  }

  unregisterItem(busName: string, objectPath: string): void {
    const id = `${busName}${objectPath}`;
    const idx = this._registeredItems.indexOf(id);
    if (idx === -1) return;
    this._registeredItems.splice(idx, 1);
    try {
      this._dbusImpl?.emit_signal('StatusNotifierItemUnregistered', new GLib.Variant('(s)', [id]));
    } catch {
      // signal emission may fail if unexported
    }
    this._onItemUnregistered(busName, objectPath);
  }

  destroy(): void {
    if (this._ownNameId) {
      Gio.DBus.session.unown_name(this._ownNameId);
      this._ownNameId = 0;
    }
    try {
      this._dbusImpl?.unexport();
    } catch {
      // unexport may throw if already unexported
    }
    this._dbusImpl = null;
    this._registeredItems = [];
  }
}
