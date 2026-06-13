import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import { logger } from '~/core/logger.ts';

export const SNI_WATCHER_BUS_NAME = 'org.kde.StatusNotifierWatcher';
const SNI_WATCHER_OBJECT = '/StatusNotifierWatcher';
const SNI_INTERFACE_NAME = 'org.kde.StatusNotifierWatcher';
const SNI_DEFAULT_ITEM_PATH = '/StatusNotifierItem';
const LOG_PREFIX = 'AuroraTray';

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
  private _registrationId = 0;
  private _ownNameId = 0;
  private _failed = false;
  private _registeredItems: string[] = [];
  private _onItemRegistered: SniRegisteredCallback;
  private _onItemUnregistered: SniUnregisteredCallback;

  constructor(
    onItemRegistered: SniRegisteredCallback,
    onItemUnregistered: SniUnregisteredCallback,
  ) {
    this._onItemRegistered = onItemRegistered;
    this._onItemUnregistered = onItemUnregistered;
  }

  start(): void {
    const ifaceInfo =
      Gio.DBusNodeInfo.new_for_xml(WATCHER_XML).lookup_interface(SNI_INTERFACE_NAME)!;

    try {
      this._registrationId = Gio.DBus.session.register_object(
        SNI_WATCHER_OBJECT,
        ifaceInfo,
        (
          _conn: Gio.DBusConnection,
          sender: string,
          _objPath: string,
          _ifaceName: string,
          methodName: string,
          params: GLib.Variant,
          invocation: Gio.DBusMethodInvocation,
        ) => {
          if (methodName === 'RegisterStatusNotifierItem') {
            const service = params.get_child_value(0).unpack() as string;
            this._handleRegisterItem(service, sender);
          } else if (methodName === 'RegisterStatusNotifierHost') {
            this._emitSignal('StatusNotifierHostRegistered', null);
          }
          invocation.return_value(null);
        },
        (
          _conn: Gio.DBusConnection,
          _sender: string,
          _objPath: string,
          _ifaceName: string,
          propertyName: string,
        ): GLib.Variant | null => {
          switch (propertyName) {
            case 'RegisteredStatusNotifierItems':
              return new GLib.Variant('as', this._registeredItems);
            case 'IsStatusNotifierHostRegistered':
              return new GLib.Variant('b', !this._failed);
            case 'ProtocolVersion':
              return new GLib.Variant('i', 0);
            default:
              return null;
          }
        },
        null,
      );
    } catch (e) {
      logger.warn(`Failed to register SNI watcher object: ${e}`, { prefix: LOG_PREFIX });
      this._failed = true;
      return;
    }

    this._ownNameId = Gio.DBus.session.own_name(
      SNI_WATCHER_BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      // GJS accepts plain functions here; types expect GObject.Closure
      (() => {
        logger.debug('Acquired org.kde.StatusNotifierWatcher', { prefix: LOG_PREFIX });
        this._emitSignal('StatusNotifierHostRegistered', null);
      }) as unknown as never,
      (() => {
        logger.warn(
          'org.kde.StatusNotifierWatcher already owned by another process. SNI icons disabled.',
          { prefix: LOG_PREFIX },
        );
        this._failed = true;
      }) as unknown as never,
    );
  }

  private _handleRegisterItem(service: string, sender: string): void {
    if (this._failed) return;

    let busName: string;
    let objectPath: string;

    if (service.startsWith('/')) {
      // Bare object path (e.g., Steam): sender is the bus name
      busName = sender;
      objectPath = service;
      logger.debug(`SNI bare-path registration from ${sender}: ${service}`, {
        prefix: LOG_PREFIX,
      });
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

    this._emitSignal('StatusNotifierItemRegistered', new GLib.Variant('(s)', [id]));
    this._onItemRegistered(busName, objectPath);
  }

  private _emitSignal(signalName: string, params: GLib.Variant | null): void {
    try {
      Gio.DBus.session.emit_signal(
        null,
        SNI_WATCHER_OBJECT,
        SNI_INTERFACE_NAME,
        signalName,
        params,
      );
    } catch {
      // signal emission may fail if unregistered
    }
  }

  unregisterItem(busName: string, objectPath: string): void {
    const id = `${busName}${objectPath}`;
    const idx = this._registeredItems.indexOf(id);
    if (idx === -1) return;
    this._registeredItems.splice(idx, 1);
    this._emitSignal('StatusNotifierItemUnregistered', new GLib.Variant('(s)', [id]));
    this._onItemUnregistered(busName, objectPath);
  }

  destroy(): void {
    if (this._ownNameId) {
      Gio.DBus.session.unown_name(this._ownNameId);
      this._ownNameId = 0;
    }
    if (this._registrationId) {
      try {
        Gio.DBus.session.unregister_object(this._registrationId);
      } catch {
        // may fail if already unregistered
      }
      this._registrationId = 0;
    }
    this._registeredItems = [];
  }
}
