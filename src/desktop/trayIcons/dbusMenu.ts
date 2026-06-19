// src/desktop/trayIcons/dbusMenu.ts
import '@girs/gjs';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Clutter from '@girs/clutter-18';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';
import { logger } from '~/core/logger.ts';

const DBUS_MENU_IFACE = 'com.canonical.dbusmenu';
const LOG_PREFIX = 'AuroraTray';

const DBUS_MENU_XML = `
<node>
  <interface name="com.canonical.dbusmenu">
    <method name="GetLayout">
      <arg name="parentId" type="i" direction="in"/>
      <arg name="recursionDepth" type="i" direction="in"/>
      <arg name="propertyNames" type="as" direction="in"/>
      <arg name="revision" type="u" direction="out"/>
      <arg name="layout" type="(ia{sv}av)" direction="out"/>
    </method>
    <method name="AboutToShow">
      <arg name="id" type="i" direction="in"/>
      <arg name="needUpdate" type="b" direction="out"/>
    </method>
    <method name="Event">
      <arg name="id" type="i" direction="in"/>
      <arg name="eventId" type="s" direction="in"/>
      <arg name="data" type="v" direction="in"/>
      <arg name="timestamp" type="u" direction="in"/>
    </method>
  </interface>
</node>`;

const DBusMenuInterfaceInfo = Gio.DBusInterfaceInfo.new_for_xml(DBUS_MENU_XML);

// @ts-ignore — _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.DBusProxy.prototype, 'init_async');
// @ts-ignore
Gio._promisify(Gio.DBusProxy.prototype, 'call');

type MenuNode = {
  id: number;
  label: string;
  type: string;
  enabled: boolean;
  visible: boolean;
  children: MenuNode[];
};

export class DBusMenuClient {
  private _proxy: Gio.DBusProxy | null = null;
  private _busName: string;
  private _objectPath: string;
  private _cancellable: Gio.Cancellable;
  private _initialized = false;

  constructor(busName: string, objectPath: string) {
    this._busName = busName;
    this._objectPath = objectPath;
    this._cancellable = new Gio.Cancellable();
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    const proxy = new Gio.DBusProxy({
      g_connection: Gio.DBus.session,
      g_name: this._busName,
      g_object_path: this._objectPath,
      g_interface_name: DBUS_MENU_IFACE,
      g_interface_info: DBusMenuInterfaceInfo,
      g_flags: Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
    });

    try {
      await proxy.init_async(GLib.PRIORITY_DEFAULT, this._cancellable);
      this._proxy = proxy;
    } catch (e) {
      if (!this._cancellable.is_cancelled()) {
        logger.warn(`DBusMenu init failed for ${this._busName}: ${e}`, { prefix: LOG_PREFIX });
      }
    }
  }

  async updateMenu(menu: PopupMenu.PopupMenu): Promise<void> {
    if (!this._proxy) return;

    // Signal the app to prepare the menu — required by some apps (e.g. Dropbox)
    try {
      await (this._proxy as any).call(
        'AboutToShow',
        new GLib.Variant('(i)', [0]),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );
    } catch {
      // Not all apps implement AboutToShow; ignore errors silently
    }

    try {
      const res = await (this._proxy as any).call(
        'GetLayout',
        new GLib.Variant('(iias)', [0, -1, []]),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );

      let layout: unknown;
      if (res instanceof GLib.Variant) {
        layout = (res.deep_unpack() as [number, unknown])[1];
      } else if (Array.isArray(res)) {
        const rawLayout = res[1];
        layout = rawLayout instanceof GLib.Variant ? rawLayout.deep_unpack() : rawLayout;
      } else {
        throw new Error('Unexpected GetLayout response format');
      }

      if (!Array.isArray(layout)) {
        throw new Error('Layout data is missing or not an array');
      }

      const nodes = this._parseChildren(layout);

      menu.removeAll();
      for (const node of nodes) {
        this._renderNode(menu, node);
      }
    } catch (e) {
      logger.warn(`GetLayout failed for ${this._busName}: ${e}`, { prefix: LOG_PREFIX });
    }
  }

  private _parseChildren(layout: unknown[]): MenuNode[] {
    if (layout.length < 3) return [];
    const childArray = layout[2];
    if (!Array.isArray(childArray)) return [];
    return (childArray as unknown[])
      .map((c) => this._parseNode(c))
      .filter((n): n is MenuNode => n !== null);
  }

  private _parseNode(raw: unknown): MenuNode | null {
    const data: unknown[] =
      raw instanceof GLib.Variant ? (raw.deep_unpack() as unknown[]) : (raw as unknown[]);

    if (!Array.isArray(data) || data.length < 3) return null;

    const id = data[0] as number;
    const props = data[1] as Record<string, unknown>;
    const childArray = data[2] as unknown[];

    const get = (key: string, def: unknown): unknown => {
      const v = props[key];
      if (v instanceof GLib.Variant) return v.unpack();
      return v ?? def;
    };

    return {
      id,
      label: String(get('label', '')),
      type: String(get('type', 'standard')),
      enabled: Boolean(get('enabled', true)),
      visible: Boolean(get('visible', true)),
      children: Array.isArray(childArray)
        ? (childArray as unknown[])
            .map((c) => this._parseNode(c))
            .filter((n): n is MenuNode => n !== null)
        : [],
    };
  }

  private _renderNode(target: PopupMenu.PopupMenu | PopupMenu.PopupSubMenu, node: MenuNode): void {
    if (!node.visible) return;

    if (node.type === 'separator') {
      target.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      return;
    }

    // Convert GTK mnemonics (e.g. "_File") to plain text
    const cleanLabel = node.label.replace(/_([^ _])/g, '$1');

    if (node.children.length > 0) {
      const sub = new PopupMenu.PopupSubMenuMenuItem(cleanLabel);
      sub.setSensitive(node.enabled);
      target.addMenuItem(sub);
      for (const child of node.children) {
        this._renderNode(sub.menu, child);
      }
      return;
    }

    const item = new PopupMenu.PopupMenuItem(cleanLabel);
    item.setSensitive(node.enabled);
    item.connect('activate', (_item, event: Clutter.Event | null) =>
      this._sendEvent(node.id, event),
    );
    target.addMenuItem(item);
  }

  private _sendEvent(id: number, event: Clutter.Event | null): void {
    if (!this._proxy) return;

    const timestamp = this._eventTimestamp(event);
    try {
      this._proxy.call(
        'Event',
        new GLib.Variant('(isvu)', [id, 'clicked', new GLib.Variant('i', 0), timestamp]),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (p, res) => {
          try {
            (p as any).call_finish(res);
          } catch (e) {
            logger.warn(`DBusMenu Event failed for id ${id}: ${e}`, { prefix: LOG_PREFIX });
          }
        },
      );
    } catch (e) {
      logger.warn(`DBusMenu Event could not be sent for id ${id}: ${e}`, {
        prefix: LOG_PREFIX,
      });
    }
  }

  private _eventTimestamp(event: Clutter.Event | null): number {
    const timestamp = event?.get_time() ?? Clutter.get_current_event_time();
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 0xffffffff) return 0;
    return Math.round(timestamp);
  }

  destroy(): void {
    this._cancellable.cancel();
    this._proxy = null;
  }
}
