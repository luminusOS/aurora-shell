import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import type Meta from '@girs/meta-18';
import Shell from '@girs/shell-18';

import { logger } from '~/core/logger.ts';
import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';

const BRIDGE_BUS_NAME = 'org.luminusos.AuroraShell.Foreground';
const BRIDGE_OBJECT_PATH = '/org/luminusos/AuroraShell/Foreground';
const BRIDGE_INTERFACE = 'org.luminusos.AuroraShell.Foreground';
const CONSUMER_BUS_NAME = 'org.luminusos.ForegroundBooster';
const LOG_PREFIX = 'AuroraForeground';

const BRIDGE_XML = `
<node>
  <interface name="${BRIDGE_INTERFACE}">
    <method name="GetFocus">
      <arg name="pid" type="u" direction="out"/>
      <arg name="app_id" type="s" direction="out"/>
    </method>
    <signal name="FocusChanged">
      <arg name="pid" type="u"/>
      <arg name="app_id" type="s"/>
    </signal>
    <property name="Version" type="u" access="read"/>
  </interface>
</node>`;

const BRIDGE_VERSION = 1;

type FocusSnapshot = { pid: number; appId: string };

export class ForegroundBridge extends Module {
  private _registrationId = 0;
  private _ownNameId = 0;
  private _ownsName = false;
  private _watchNameId = 0;
  private _consumerOwner: string | null = null;
  private _focusWindowId = 0;
  private _current: FocusSnapshot = { pid: 0, appId: '' };

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();

    const ifaceInfo = Gio.DBusNodeInfo.new_for_xml(BRIDGE_XML).lookup_interface(BRIDGE_INTERFACE)!;

    try {
      this._registrationId = Gio.DBus.session.register_object(
        BRIDGE_OBJECT_PATH,
        ifaceInfo,
        (
          _conn: Gio.DBusConnection,
          sender: string,
          _objPath: string,
          _ifaceName: string,
          _methodName: string,
          _params: GLib.Variant,
          invocation: Gio.DBusMethodInvocation,
        ) => this._handleGetFocus(sender, invocation),
        (
          _conn: Gio.DBusConnection,
          _sender: string,
          _objPath: string,
          _ifaceName: string,
          propertyName: string,
        ): GLib.Variant | null =>
          propertyName === 'Version' ? new GLib.Variant('u', BRIDGE_VERSION) : null,
        null,
      );
    } catch (e) {
      logger.warn(`Failed to register foreground bridge: ${e}`, { prefix: LOG_PREFIX });
      this._registrationId = 0;
      return;
    }

    this._ownNameId = Gio.DBus.session.own_name(
      BRIDGE_BUS_NAME,
      Gio.BusNameOwnerFlags.DO_NOT_QUEUE,
      () => {
        this._ownsName = true;
        this._emitFocusChanged();
      },
      () => {
        this._ownsName = false;
        logger.warn(`${BRIDGE_BUS_NAME} is owned by another process`, { prefix: LOG_PREFIX });
      },
    );

    this._watchNameId = Gio.DBus.watch_name(
      Gio.BusType.SESSION,
      CONSUMER_BUS_NAME,
      Gio.BusNameWatcherFlags.NONE,
      (_conn: Gio.DBusConnection, _name: string, owner: string) => {
        this._consumerOwner = owner;
        this._emitFocusChanged();
      },
      () => {
        this._consumerOwner = null;
      },
    );

    this._focusWindowId = global.display.connect('notify::focus-window', () => this._syncFocus());
    this._syncFocus();
  }

  override disable(): void {
    if (this._focusWindowId) {
      global.display.disconnect(this._focusWindowId);
      this._focusWindowId = 0;
    }
    if (this._watchNameId) {
      Gio.DBus.unwatch_name(this._watchNameId);
      this._watchNameId = 0;
    }
    if (this._ownNameId) {
      Gio.DBus.session.unown_name(this._ownNameId);
      this._ownNameId = 0;
    }
    if (this._registrationId) {
      Gio.DBus.session.unregister_object(this._registrationId);
      this._registrationId = 0;
    }
    this._consumerOwner = null;
    this._ownsName = false;
    this._current = { pid: 0, appId: '' };
  }

  private _handleGetFocus(sender: string, invocation: Gio.DBusMethodInvocation): void {
    if (sender !== this._consumerOwner) {
      invocation.return_dbus_error(
        'org.freedesktop.DBus.Error.AccessDenied',
        'GetFocus is restricted to gnome-foreground-booster',
      );
      return;
    }

    invocation.return_value(new GLib.Variant('(us)', [this._current.pid, this._current.appId]));
  }

  private _syncFocus(): void {
    const next = this._snapshotFocus();
    if (next.pid === this._current.pid && next.appId === this._current.appId) return;
    this._current = next;
    this._emitFocusChanged();
  }

  private _snapshotFocus(): FocusSnapshot {
    const window: Meta.Window | null = global.display.get_focus_window();
    if (!window) return { pid: 0, appId: '' };

    const app = Shell.WindowTracker.get_default().get_window_app(window);
    return { pid: window.get_pid(), appId: app?.get_id() || '' };
  }

  private _emitFocusChanged(): void {
    if (!this._consumerOwner || !this._ownsName) return;

    try {
      Gio.DBus.session.emit_signal(
        this._consumerOwner,
        BRIDGE_OBJECT_PATH,
        BRIDGE_INTERFACE,
        'FocusChanged',
        new GLib.Variant('(us)', [this._current.pid, this._current.appId]),
      );
    } catch (e) {
      logger.warn(`Failed to emit FocusChanged: ${e}`, { prefix: LOG_PREFIX });
    }
  }
}
