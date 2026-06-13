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
    <property name="DesktopEntry" type="s" access="read"/>
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
const GENERIC_APP_ID_COMPONENTS = new Set([
  'app',
  'application',
  'desktop',
  'indicator',
  'status',
  'statusicon',
  'status_icon',
  'tray',
]);

// @ts-ignore — _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.DBusProxy.prototype, 'init_async');
// @ts-ignore
Gio._promisify(Gio.DBusProxy.prototype, 'call', 'call_finish');

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
  sniId: string;
  desktopEntry: string;
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
    const desktopEntry =
      (proxy.get_cached_property('DesktopEntry')?.unpack() as string | undefined) ?? '';

    const menuPath = proxy.get_cached_property('Menu')?.unpack() as string | undefined;
    logger.debug(
      `Registered item ${id}. Id=${sniId || '(none)'}. DesktopEntry=${desktopEntry || '(none)'}. Menu path: ${menuPath || 'none'}. Status: ${item.status}`,
      { prefix: LOG_PREFIX },
    );

    const signalId = proxy.connect('g-signal', (_proxy, _sender, signalName, params) => {
      if (signalName === 'NewStatus') {
        const newStatus = params.get_child_value(0).unpack() as string;
        item.status = newStatus as TrayItemStatus;
        this._callbacks.onStatusChanged(id, item.status);
      } else if (signalName === 'NewIcon' || signalName === 'NewAttentionIcon') {
        // Electron/Discord emits NewIcon without PropertiesChanged, leaving the
        // proxy cache stale. Re-fetch icon properties before resolving.
        this._refetchIconProperties(proxy)
          .then(() => {
            if (!this._entries.has(id)) return;
            item.icon = this._resolveIcon(proxy, signalName);
            this._callbacks.onIconChanged(id);
          })
          .catch((e) =>
            logger.warn(`Icon property refresh failed for ${id}: ${e}`, { prefix: LOG_PREFIX }),
          );
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

    this._entries.set(id, { proxy, item, sniId, desktopEntry, signalId, nameWatchId, cancellable });
    this._callbacks.onItemAdded(item);
  }

  private async _refetchIconProperties(proxy: Gio.DBusProxy): Promise<void> {
    const props = [
      'IconName',
      'IconThemePath',
      'IconPixmap',
      'AttentionIconName',
      'AttentionIconPixmap',
    ];
    await Promise.allSettled(
      props.map(async (prop) => {
        try {
          const result = await (proxy as any).call(
            'org.freedesktop.DBus.Properties.Get',
            new GLib.Variant('(ss)', ['org.kde.StatusNotifierItem', prop]),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
          );
          proxy.set_cached_property(prop, result.get_child_value(0).get_variant());
        } catch {
          // property may not be supported by this item
        }
      }),
    );
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
      const themedIcon = this._resolveThemedIcon(iconName, iconThemePath, itemId, reason);
      if (themedIcon) {
        logger.debug(
          `SNI icon ${itemId} reason=${reason} source=theme-path name=${iconName} path=${iconThemePath}`,
          { prefix: LOG_PREFIX },
        );
        return themedIcon;
      }
    }

    const pixmaps = proxy.get_cached_property(useAttention ? 'AttentionIconPixmap' : 'IconPixmap');
    if (pixmaps) {
      const pb = this._extractPixbuf(pixmaps, itemId, reason);
      if (pb) {
        logger.debug(
          `SNI icon ${itemId} reason=${reason} source=pixmap size=${pb.get_width()}x${pb.get_height()}`,
          { prefix: LOG_PREFIX },
        );
        return pb;
      }
    }

    if (iconName) {
      logger.debug(
        `SNI icon ${itemId} reason=${reason} source=icon-name name=${iconName} path=${iconThemePath || 'none'}`,
        { prefix: LOG_PREFIX },
      );
      return iconName;
    }

    logger.debug(`SNI icon ${itemId} reason=${reason} source=fallback`, { prefix: LOG_PREFIX });
    return 'image-missing-symbolic';
  }

  refreshIcons(reason = 'theme-change'): void {
    for (const entry of this._entries.values()) {
      entry.item.icon = this._resolveIcon(entry.proxy, reason);
      this._callbacks.onIconChanged(entry.item.id);
    }
  }

  private _resolveThemedIcon(
    iconName: string,
    iconThemePath: string,
    itemId: string,
    reason: string,
  ): Gio.Icon | GdkPixbuf.Pixbuf | null {
    if (!iconThemePath) return null;

    try {
      const theme = St.IconTheme.new();
      theme.append_search_path(iconThemePath);
      const iconInfo = theme.lookup_icon(iconName, 24, St.IconLookupFlags.FORCE_SIZE);
      const filename =
        iconInfo?.get_filename() ?? this._findIconThemePathFile(iconThemePath, iconName);
      if (!filename) return null;

      // SVGs go through GTK's symbolic pipeline via St.Icon; return as-is.
      if (filename.toLowerCase().endsWith('.svg')) {
        return new Gio.FileIcon({ file: Gio.File.new_for_path(filename) });
      }

      // Raster icons (PNG etc.) bypass GTK symbolic colorization — load and recolor manually.
      const pixbuf = GdkPixbuf.Pixbuf.new_from_file(filename);
      if (!pixbuf) return null;
      return this._recolorFilePixbuf(pixbuf, itemId, reason);
    } catch (e) {
      logger.warn(`Failed to resolve themed SNI icon ${iconName} from ${iconThemePath}: ${e}`, {
        prefix: LOG_PREFIX,
      });
      return null;
    }
  }

  private _findIconThemePathFile(iconThemePath: string, iconName: string): string | null {
    if (!iconThemePath) return null;
    if (iconName.startsWith('/'))
      return Gio.File.new_for_path(iconName).query_exists(null) ? iconName : null;

    const extensions = ['', '.svg', '.png', '.xpm'];
    const subdirs = ['', 'icons', 'hicolor/16x16/apps', 'hicolor/24x24/apps', 'hicolor/32x32/apps'];
    for (const subdir of subdirs) {
      const dir = subdir ? GLib.build_filenamev([iconThemePath, subdir]) : iconThemePath;
      for (const ext of extensions) {
        const filename = GLib.build_filenamev([dir, `${iconName}${ext}`]);
        if (Gio.File.new_for_path(filename).query_exists(null)) return filename;
      }
    }

    return null;
  }

  private _recolorFilePixbuf(
    pixbuf: GdkPixbuf.Pixbuf,
    itemId: string,
    reason: string,
  ): GdkPixbuf.Pixbuf {
    if (!this._shouldRecolorSymbolicPixmaps() || pixbuf.get_n_channels() !== 4) return pixbuf;

    const w = pixbuf.get_width();
    const h = pixbuf.get_height();
    const rowstride = pixbuf.get_rowstride();
    const data = pixbuf.get_pixels();
    if (!data) return pixbuf;

    let opaquePixels = 0;
    let monochromePixels = 0;
    for (let row = 0; row < h; row++) {
      const base = row * rowstride;
      for (let col = 0; col < w; col++) {
        const i = base + col * 4;
        const a = data[i + 3]!;
        if (a < 16) continue;
        opaquePixels++;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        if (Math.max(r, g, b) - Math.min(r, g, b) <= SYMBOLIC_CHANNEL_TOLERANCE) monochromePixels++;
      }
    }

    if (opaquePixels === 0 || monochromePixels / opaquePixels < SYMBOLIC_REQUIRED_RATIO)
      return pixbuf;

    const [targetR, targetG, targetB] = this._panelIconColor();
    const pixels = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++) {
      const srcBase = row * rowstride;
      const dstBase = row * w * 4;
      for (let col = 0; col < w; col++) {
        const si = srcBase + col * 4;
        const di = dstBase + col * 4;
        pixels[di] = targetR;
        pixels[di + 1] = targetG;
        pixels[di + 2] = targetB;
        pixels[di + 3] = data[si + 3]!;
      }
    }

    logger.debug(
      `Recolored symbolic theme-path icon ${itemId} reason=${reason} scheme=${this._getColorScheme()} size=${w}x${h}`,
      { prefix: LOG_PREFIX },
    );

    return GdkPixbuf.Pixbuf.new_from_bytes(pixels, GdkPixbuf.Colorspace.RGB, true, 8, w, h, w * 4);
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
      logger.debug(`Ignoring tiny SNI pixmap ${itemId} reason=${reason} size=${w}x${h}`, {
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
      logger.debug(
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

  getBusNames(): string[] {
    const names = new Set<string>();
    for (const entry of this._entries.values()) {
      if (entry.proxy.g_name) names.add(entry.proxy.g_name);
      if (entry.proxy.g_name_owner) names.add(entry.proxy.g_name_owner);
    }
    return [...names];
  }

  // Fallback dedup: match BG app ID against SNI metadata.
  // Used when the app doesn't own a D-Bus well-known name matching its app ID
  // (common for Flatpak apps that register SNI under a unique bus name).
  hasSniForAppId(appId: string): boolean {
    const appIds = this._appIdCandidates(appId);
    const appComponents = new Set(
      [...appIds]
        .map((candidate) => candidate.split('.').at(-1) ?? candidate)
        .filter((component) => this._isSpecificAppComponent(component)),
    );

    for (const entry of this._entries.values()) {
      if (entry.desktopEntry && this._desktopEntryMatchesAppIds(entry.desktopEntry, appIds))
        return true;

      if (!entry.sniId) continue;
      const sniLower = entry.sniId.toLowerCase();
      if (appIds.has(sniLower)) return true;

      const sniLast = sniLower.split('.').at(-1) ?? sniLower;
      if (this._isSpecificAppComponent(sniLast) && appComponents.has(sniLast)) return true;
    }
    return false;
  }

  private _desktopEntryMatchesAppIds(desktopEntry: string, appIds: Set<string>): boolean {
    const entry = desktopEntry.toLowerCase();
    const entryWithoutSuffix = entry.replace(/\.desktop$/, '');

    for (const appId of appIds) {
      if (entry === appId || entry === `${appId}.desktop` || entryWithoutSuffix === appId)
        return true;
    }

    return false;
  }

  private _appIdCandidates(appId: string): Set<string> {
    const candidates = new Set<string>();
    let candidate = appId.toLowerCase();
    while (candidate) {
      candidates.add(candidate);
      if (!candidate.endsWith('.desktop')) break;
      candidate = candidate.slice(0, -'.desktop'.length);
    }
    return candidates;
  }

  private _isSpecificAppComponent(component: string): boolean {
    return component.length >= 4 && !GENERIC_APP_ID_COMPONENTS.has(component);
  }

  destroy(): void {
    for (const id of [...this._entries.keys()]) {
      this._removeEntry(id);
    }
  }
}
