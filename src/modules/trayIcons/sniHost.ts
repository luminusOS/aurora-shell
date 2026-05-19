// src/modules/trayIcons/sniHost.ts
import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import GdkPixbuf from '@girs/gdkpixbuf-2.0';
import St from '@girs/st-18';

import type { TrayItem, TrayItemStatus } from './trayState.ts';
import type { SniWatcher } from './sniWatcher.ts';
import { logger } from '~/core/logger.ts';

const SNI_ITEM_XML = `
<node>
  <interface name="org.kde.StatusNotifierItem">
    <property name="Id" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <property name="IconThemePath" type="s" access="read"/>
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
const MIN_PIXMAP_SIZE = 8;
const SYMBOLIC_CHANNEL_TOLERANCE = 18;
const SYMBOLIC_REQUIRED_RATIO = 0.92;
const LIGHT_PANEL_ICON = [48, 48, 48] as const;
const DARK_PANEL_ICON = [250, 250, 251] as const;
const LOG_PREFIX = 'AuroraTray';

// @ts-ignore — _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.DBusProxy.prototype, 'init_async');

type HostCallbacks = {
  onItemAdded(item: TrayItem): void;
  onItemRemoved(id: string): void;
  onStatusChanged(id: string, status: TrayItemStatus): void;
  onIconChanged(id: string): void;
};

type SniHostOptions = {
  getColorScheme?: () => string;
  shouldRecolorSymbolicPixmaps?: () => boolean;
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
  private _getColorScheme: () => string;
  private _shouldRecolorSymbolicPixmaps: () => boolean;

  constructor(watcher: SniWatcher, callbacks: HostCallbacks, options: SniHostOptions = {}) {
    this._watcher = watcher;
    this._callbacks = callbacks;
    this._getColorScheme = options.getColorScheme ?? (() => 'prefer-dark');
    this._shouldRecolorSymbolicPixmaps = options.shouldRecolorSymbolicPixmaps ?? (() => true);
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
        logger.warn(`Failed to create SNI proxy for ${id}: ${e}`, { prefix: LOG_PREFIX });
      }
      return;
    }

    const item = this._makeItem(id, proxy);
    const sniId = (proxy.get_cached_property('Id')?.unpack() as string | undefined) ?? '';

    const menuPath = proxy.get_cached_property('Menu')?.unpack() as string | undefined;
    logger.log(
      `Registered item ${id}. Id=${sniId || '(none)'}. Menu path: ${menuPath || 'none'}. Status: ${item.status}`,
      { prefix: LOG_PREFIX },
    );

    const signalId = proxy.connect('g-signal', (_proxy, _sender, signalName, params) => {
      if (signalName === 'NewStatus') {
        const newStatus = params.get_child_value(0).unpack() as string;
        item.status = newStatus as TrayItemStatus;
        this._callbacks.onStatusChanged(id, item.status);
      } else if (signalName === 'NewIcon' || signalName === 'NewAttentionIcon') {
        item.icon = this._resolveIcon(proxy, signalName);
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

  private _resolveIcon(proxy: Gio.DBusProxy, reason = 'initial'): TrayItem['icon'] {
    const status = (proxy.get_cached_property('Status')?.unpack() as string) ?? 'Active';
    const useAttention = status === 'NeedsAttention';
    const itemId = `${proxy.g_name}${proxy.g_object_path}`;

    const iconName =
      (proxy
        .get_cached_property(useAttention ? 'AttentionIconName' : 'IconName')
        ?.unpack() as string) ?? '';
    const iconThemePath =
      (proxy.get_cached_property('IconThemePath')?.unpack() as string | undefined) ?? '';
    if (iconName) {
      const themedIcon = this._resolveThemedIcon(iconName, iconThemePath);
      if (themedIcon) {
        logger.log(
          `SNI icon ${itemId} reason=${reason} source=theme-path name=${iconName} path=${iconThemePath}`,
          { prefix: LOG_PREFIX },
        );
        return themedIcon;
      }
      logger.log(
        `SNI icon ${itemId} reason=${reason} source=icon-name name=${iconName} path=${iconThemePath || 'none'}`,
        { prefix: LOG_PREFIX },
      );
      return iconName;
    }

    const pixmaps = proxy.get_cached_property(useAttention ? 'AttentionIconPixmap' : 'IconPixmap');
    if (pixmaps) {
      const pb = this._extractPixbuf(pixmaps, itemId, reason);
      if (pb) {
        logger.log(
          `SNI icon ${itemId} reason=${reason} source=pixmap size=${pb.get_width()}x${pb.get_height()}`,
          { prefix: LOG_PREFIX },
        );
        return pb;
      }
    }

    logger.log(`SNI icon ${itemId} reason=${reason} source=fallback`, { prefix: LOG_PREFIX });
    return 'image-missing-symbolic';
  }

  refreshIcons(reason = 'theme-change'): void {
    for (const entry of this._entries.values()) {
      entry.item.icon = this._resolveIcon(entry.proxy, reason);
      this._callbacks.onIconChanged(entry.item.id);
    }
  }

  private _resolveThemedIcon(iconName: string, iconThemePath: string): Gio.Icon | null {
    if (!iconThemePath) return null;

    try {
      const theme = St.IconTheme.new();
      theme.append_search_path(iconThemePath);
      const iconInfo = theme.lookup_icon(iconName, 24, St.IconLookupFlags.FORCE_SIZE);
      const filename = iconInfo?.get_filename();
      if (!filename) return null;

      return new Gio.FileIcon({ file: Gio.File.new_for_path(filename) });
    } catch (e) {
      logger.warn(`Failed to resolve themed SNI icon ${iconName} from ${iconThemePath}: ${e}`, {
        prefix: LOG_PREFIX,
      });
      return null;
    }
  }

  private _extractPixbuf(
    variant: GLib.Variant,
    itemId: string,
    reason: string,
  ): GdkPixbuf.Pixbuf | null {
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
    if (w < MIN_PIXMAP_SIZE || h < MIN_PIXMAP_SIZE) {
      logger.log(`Ignoring tiny SNI pixmap ${itemId} reason=${reason} size=${w}x${h}`, {
        prefix: LOG_PREFIX,
      });
      return null;
    }

    // SNI IconPixmap is a(iiay): array of (width, height, ARGB data in network byte order)
    // GdkPixbuf expects RGBA. We must swap ARGB -> RGBA.
    const unpacked = data.get_data();
    if (!unpacked || unpacked.length < w * h * 4) return null;

    const pixels = new Uint8Array(unpacked.length);
    const symbolic = this._shouldRecolorSymbolicPixmaps() && this._isSymbolicPixmap(unpacked, w, h);
    const [targetR, targetG, targetB] = this._panelIconColor();
    for (let i = 0; i < unpacked.length; i += 4) {
      pixels[i] = symbolic ? targetR : unpacked[i + 1]!; // R
      pixels[i + 1] = symbolic ? targetG : unpacked[i + 2]!; // G
      pixels[i + 2] = symbolic ? targetB : unpacked[i + 3]!; // B
      pixels[i + 3] = unpacked[i]!; // A
    }

    if (symbolic) {
      logger.log(
        `Recolored symbolic SNI pixmap ${itemId} reason=${reason} scheme=${this._getColorScheme()} size=${w}x${h}`,
        { prefix: LOG_PREFIX },
      );
    }

    return GdkPixbuf.Pixbuf.new_from_bytes(pixels, GdkPixbuf.Colorspace.RGB, true, 8, w, h, w * 4);
  }

  private _panelIconColor(): readonly [number, number, number] {
    return this._getColorScheme() === 'prefer-light' ? LIGHT_PANEL_ICON : DARK_PANEL_ICON;
  }

  private _isSymbolicPixmap(data: Uint8Array, width: number, height: number): boolean {
    let opaquePixels = 0;
    let monochromePixels = 0;
    const expectedLength = width * height * 4;

    for (let i = 0; i < expectedLength; i += 4) {
      const a = data[i]!;
      if (a < 16) continue;

      opaquePixels++;
      const r = data[i + 1]!;
      const g = data[i + 2]!;
      const b = data[i + 3]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min <= SYMBOLIC_CHANNEL_TOLERANCE) monochromePixels++;
    }

    if (opaquePixels === 0) return false;
    return monochromePixels / opaquePixels >= SYMBOLIC_REQUIRED_RATIO;
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
              logger.warn(`Activate failed for ${id}: ${e}`, { prefix: LOG_PREFIX });
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
              logger.warn(`SecondaryActivate failed for ${id}: ${e}`, { prefix: LOG_PREFIX });
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
              logger.warn(`ContextMenu failed for ${id}: ${e}`, { prefix: LOG_PREFIX });
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
