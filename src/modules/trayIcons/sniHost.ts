// src/modules/trayIcons/sniHost.ts
import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import GdkPixbuf from '@girs/gdkpixbuf-2.0';

import type { TrayItem, TrayItemStatus } from './trayState.ts';
import type { SniWatcher } from './sniWatcher.ts';
import { logger } from '~/core/logger.ts';

const SNI_ITEM_XML = `
<node>
  <interface name="org.kde.StatusNotifierItem">
    <property name="Id" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <property name="IconPixmap" type="a(iiay)" access="read"/>
    <property name="AttentionIconName" type="s" access="read"/>
    <property name="AttentionIconPixmap" type="a(iiay)" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
    <property name="Menu" type="o" access="read"/>
    <method name="Activate"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method>
    <method name="SecondaryActivate"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method>
    <method name="ContextMenu"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method>
    <signal name="NewStatus"><arg name="status" type="s"/></signal>
    <signal name="NewIcon"/>
    <signal name="NewAttentionIcon"/>
    <signal name="NewTitle"/>
    <signal name="NewToolTip"/>
  </interface>
</node>`;

const SniItemInterfaceInfo = Gio.DBusInterfaceInfo.new_for_xml(SNI_ITEM_XML);

// @ts-ignore — _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.DBusProxy.prototype, 'init_async');

type HostCallbacks = {
  onItemAdded(item: TrayItem): void;
  onItemRemoved(id: string): void;
  onStatusChanged(id: string, status: TrayItemStatus): void;
  onIconChanged(id: string): void;
};

type SniEntry = {
  proxy: Gio.DBusProxy;
  item: TrayItem;
  sniId: string; // SNI Id property — used for app-id-based dedup fallback
  signalId: number;
  nameWatchId: number;
  cancellable: Gio.Cancellable;
};

export class SniHost {
  private _entries = new Map<string, SniEntry>();
  private _callbacks: HostCallbacks;
  private _watcher: SniWatcher;

  constructor(watcher: SniWatcher, callbacks: HostCallbacks) {
    this._watcher = watcher;
    this._callbacks = callbacks;
  }

  async registerItem(busName: string, objectPath: string): Promise<void> {
    const id = `${busName}${objectPath}`;
    if (this._entries.has(id)) return;

    const cancellable = new Gio.Cancellable();
    const proxy = new Gio.DBusProxy({
      g_connection: Gio.DBus.session,
      g_interface_name: 'org.kde.StatusNotifierItem',
      g_interface_info: SniItemInterfaceInfo,
      g_name: busName,
      g_object_path: objectPath,
      g_flags: Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
    });

    try {
      await proxy.init_async(GLib.PRIORITY_DEFAULT, cancellable);
    } catch (e) {
      if (!(e as any)?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        logger.warn(`[AuroraTray] Failed to create SNI proxy for ${id}: ${e}`);
      }
      return;
    }

    const item = this._makeItem(id, proxy);
    const sniId = (proxy.get_cached_property('Id')?.unpack() as string | undefined) ?? '';

    const menuPath = proxy.get_cached_property('Menu')?.unpack() as string | undefined;
    logger.log(
      `[AuroraTray] Registered item ${id}. Id=${sniId || '(none)'}. Menu path: ${menuPath || 'none'}. Status: ${item.status}`,
    );

    const signalId = proxy.connect('g-signal', (_proxy, _sender, signalName, params) => {
      if (signalName === 'NewStatus') {
        const newStatus = params.get_child_value(0).unpack() as string;
        item.status = newStatus as TrayItemStatus;
        this._callbacks.onStatusChanged(id, item.status);
      } else if (signalName === 'NewIcon' || signalName === 'NewAttentionIcon') {
        item.icon = this._resolveIcon(proxy);
        this._callbacks.onIconChanged(id);
      }
    });

    const nameWatchId = Gio.DBus.session.watch_name(
      busName,
      Gio.BusNameWatcherFlags.NONE,
      // GJS accepts plain functions here; types expect GObject.Closure
      null as unknown as never,
      (() => {
        const wasTracked = this._entries.has(id);
        this._removeEntry(id);
        if (wasTracked) this._watcher.unregisterItem(busName, objectPath);
      }) as unknown as never,
    );

    this._entries.set(id, { proxy, item, sniId, signalId, nameWatchId, cancellable });
    this._callbacks.onItemAdded(item);
  }

  private _resolveIcon(proxy: Gio.DBusProxy): string | GdkPixbuf.Pixbuf {
    const status = (proxy.get_cached_property('Status')?.unpack() as string) ?? 'Active';
    const useAttention = status === 'NeedsAttention';

    const iconName =
      (proxy
        .get_cached_property(useAttention ? 'AttentionIconName' : 'IconName')
        ?.unpack() as string) ?? '';
    if (iconName) return iconName;

    const pixmaps = proxy.get_cached_property(useAttention ? 'AttentionIconPixmap' : 'IconPixmap');
    if (pixmaps) {
      const pb = this._extractPixbuf(pixmaps);
      if (pb) return pb;
    }

    return 'image-missing-symbolic';
  }

  private _extractPixbuf(variant: GLib.Variant): GdkPixbuf.Pixbuf | null {
    const n = variant.n_children();
    if (n === 0) return null;

    let bestChild = variant.get_child_value(0);
    let maxW = 0;
    for (let i = 0; i < n; i++) {
      const child = variant.get_child_value(i);
      const w = child.get_child_value(0).unpack() as number;
      if (w > maxW) {
        maxW = w;
        bestChild = child;
      }
    }

    const w = bestChild.get_child_value(0).unpack() as number;
    const h = bestChild.get_child_value(1).unpack() as number;
    const data = bestChild.get_child_value(2).get_data_as_bytes(); // GLib.Bytes

    if (!data || w <= 0 || h <= 0) return null;

    // SNI IconPixmap is a(iiay): array of (width, height, ARGB data in network byte order)
    // GdkPixbuf expects RGBA. We must swap ARGB -> RGBA.
    const unpacked = data.get_data();
    if (!unpacked || unpacked.length < w * h * 4) return null;

    const pixels = new Uint8Array(unpacked.length);
    for (let i = 0; i < unpacked.length; i += 4) {
      pixels[i] = unpacked[i + 1]!; // R
      pixels[i + 1] = unpacked[i + 2]!; // G
      pixels[i + 2] = unpacked[i + 3]!; // B
      pixels[i + 3] = unpacked[i]!; // A
    }

    return GdkPixbuf.Pixbuf.new_from_data(
      pixels,
      GdkPixbuf.Colorspace.RGB,
      true,
      8,
      w,
      h,
      w * 4,
      null,
    );
  }

  private _makeItem(id: string, proxy: Gio.DBusProxy): TrayItem {
    return {
      id,
      icon: this._resolveIcon(proxy),
      get tooltip(): string | undefined {
        const raw = proxy.get_cached_property('ToolTip');
        if (!raw) return undefined;
        try {
          const desc = raw.get_child_value(3).unpack() as string;
          if (desc) return desc;
          const title = raw.get_child_value(2).unpack() as string;
          return title || undefined;
        } catch {
          return undefined;
        }
      },
      get status(): TrayItemStatus {
        return (proxy.get_cached_property('Status')?.unpack() as TrayItemStatus) ?? 'Active';
      },
      set status(v: TrayItemStatus) {
        proxy.set_cached_property('Status', new GLib.Variant('s', v));
      },
      menuBusName: proxy.g_name,
      menuObjectPath: proxy.get_cached_property('Menu')?.unpack() as string | undefined,
      activate: (x: number, y: number) => {
        proxy.call(
          'Activate',
          new GLib.Variant('(ii)', [Math.round(x), Math.round(y)]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (p, res) => {
            try {
              p?.call_finish(res);
            } catch (e) {
              logger.warn(`[AuroraTray] Activate failed for ${id}: ${e}`);
            }
          },
        );
      },
      secondaryActivate: (x: number, y: number) => {
        proxy.call(
          'SecondaryActivate',
          new GLib.Variant('(ii)', [Math.round(x), Math.round(y)]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (p, res) => {
            try {
              p?.call_finish(res);
            } catch (e) {
              logger.warn(`[AuroraTray] SecondaryActivate failed for ${id}: ${e}`);
            }
          },
        );
      },
      showMenu: (x: number, y: number) => {
        proxy.call(
          'ContextMenu',
          new GLib.Variant('(ii)', [Math.round(x), Math.round(y)]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (p, res) => {
            try {
              p?.call_finish(res);
            } catch (e) {
              logger.warn(`[AuroraTray] ContextMenu failed for ${id}: ${e}`);
            }
          },
        );
      },
      destroy: () => {
        this._removeEntry(id);
      },
    };
  }

  private _removeEntry(id: string): void {
    const entry = this._entries.get(id);
    if (!entry) return;
    this._entries.delete(id);

    entry.cancellable.cancel();
    entry.proxy.disconnect(entry.signalId);
    Gio.DBus.session.unwatch_name(entry.nameWatchId);

    this._callbacks.onItemRemoved(id);
  }

  hasItemForBus(busName: string): boolean {
    for (const [id, entry] of this._entries) {
      if (id.startsWith(`${busName}/`)) return true;
      // busName may be a unique name; compare against the proxy's actual unique owner
      const uniqueOwner = entry.proxy.g_name_owner;
      if (uniqueOwner && uniqueOwner === busName) return true;
    }
    return false;
  }

  // Fallback dedup: match BG app ID against SNI item's Id property.
  // Used when the app doesn't own a D-Bus well-known name matching its app ID
  // (common for Flatpak apps that register SNI under a unique bus name).
  hasSniForAppId(appId: string): boolean {
    const lower = appId.toLowerCase();
    // Last dot-component: "com.rtosta.zapzap" → "zapzap"
    const lastComponent = lower.split('.').at(-1) ?? lower;
    if (lastComponent.length < 4) return false; // too short to match reliably
    for (const entry of this._entries.values()) {
      if (!entry.sniId) continue;
      const sniLower = entry.sniId.toLowerCase();
      // Exact match or BG app ID ends with last component of SNI Id (and vice versa)
      if (lower === sniLower) return true;
      const sniLast = sniLower.split('.').at(-1) ?? sniLower;
      if (sniLast.length >= 4 && lastComponent === sniLast) return true;
    }
    return false;
  }

  destroy(): void {
    for (const id of [...this._entries.keys()]) {
      this._removeEntry(id);
    }
  }
}
