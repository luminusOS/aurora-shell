import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
import Shell from '@girs/shell-18';
import type { Button as PanelMenuButton } from '@girs/gnome-shell/ui/panelMenu';

// @ts-ignore
Gio._promisify(Gio.DBusConnection.prototype, 'call');
// @ts-ignore - _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_contents_async');

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';
import { getQuickSettingsGrid } from '~/shared/quickSettings.ts';

import { appIdCandidates } from './appIdentity.ts';
import { TrayContainer } from './trayContainer.ts';
import { BackgroundAppsSource } from './backgroundAppsSource.ts';
import { SniWatcher } from './sniWatcher.ts';
import { SniHost } from './sniHost.ts';
import type { TrayItem, TrayItemStatus } from './trayState.ts';

const PANEL_INDICATOR_ID = 'aurora-tray-icons';
const LOG_PREFIX = 'AuroraTray';

type BgTrayEntry = {
  itemId: string;
  app: Shell.App;
};

export class TrayIcons extends Module {
  private _container: TrayContainer | null = null;
  private _sniWatcher: SniWatcher | null = null;
  private _sniHost: SniHost | null = null;
  private _bgSource: BackgroundAppsSource | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _bgItemAppIds = new Map<string, BgTrayEntry>();
  private _dedupBgApps = true;
  private _bgAppsToggle: any = null;
  private _bgAppsGrid: any = null;
  private _desktopSettings: SettingsManager | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._lifecycle = new LifecycleScope();
    const settings = this.context.settings.getRawSettings();
    this._desktopSettings = this.context.settings.getSchema('org.gnome.desktop.interface');
    const iconSize = settings.get_int('tray-icons-icon-size');
    const limit = settings.get_int('tray-icons-limit');
    const attentionTimeout = settings.get_int('tray-icons-attention-timeout');
    this._dedupBgApps = settings.get_boolean('tray-icons-dedup-bg-apps');
    if (settings.get_boolean('tray-icons-hide-bg-quick-settings')) {
      this._hideBgAppsQuickSettings();
    }

    this._container = new (TrayContainer as unknown as new (
      iconSize: number,
      limit: number,
    ) => TrayContainer)(iconSize, limit);
    this._container.setAttentionTimeout(attentionTimeout);

    Main.panel.addToStatusArea(
      PANEL_INDICATOR_ID,
      this._container as unknown as PanelMenuButton,
      0,
      'right',
    );

    this._sniWatcher = new SniWatcher(
      (busName, objectPath) => {
        this._sniHost
          ?.registerItem(busName, objectPath)
          ?.catch((e) => logger.warn(`registerItem failed: ${e}`, { prefix: LOG_PREFIX }));
      },
      (_busName, _objectPath) => {},
    );
    this._sniHost = new SniHost(
      this._sniWatcher,
      {
        onItemAdded: (item) => this._onSniItemAdded(item),
        onItemRemoved: (id) => this._onItemRemoved(id),
        onStatusChanged: (id, status) => this._onStatusChanged(id, status),
        onIconChanged: (id) => this._container?.updateItemIcon(id),
      },
      {
        getColorScheme: () => this._desktopSettings?.getString('color-scheme') ?? 'prefer-dark',
        shouldRecolorSymbolicPixmaps: () =>
          settings.get_boolean('tray-icons-recolor-symbolic-pixmaps'),
      },
    );
    this._sniWatcher.start();
    this._lifecycle.connect(this._desktopSettings, 'changed::color-scheme', () => {
      const scheme = this._desktopSettings?.getString('color-scheme') ?? 'unknown';
      logger.debug(`Color scheme changed to ${scheme}; refreshing SNI icons`, {
        prefix: LOG_PREFIX,
      });
      this._sniHost?.refreshIcons('color-scheme');
    });

    this._bgSource = new BackgroundAppsSource({
      onItemAdded: (item, appId, app) => this._onBgItemAdded(item, appId, app).catch(() => {}),
      onItemRemoved: (id) => this._onItemRemoved(id),
    });
    this._bgSource
      .start()
      .catch((e) => logger.warn(`bg source start failed: ${e}`, { prefix: LOG_PREFIX }));

    this._lifecycle.connect(settings, 'changed::tray-icons-limit', () => {
      this._container?.setLimit(settings.get_int('tray-icons-limit'));
    });
    this._lifecycle.connect(settings, 'changed::tray-icons-icon-size', () => {
      this._container?.setIconSize(settings.get_int('tray-icons-icon-size'));
    });
    this._lifecycle.connect(settings, 'changed::tray-icons-attention-timeout', () => {
      this._container?.setAttentionTimeout(settings.get_int('tray-icons-attention-timeout'));
    });
    this._lifecycle.connect(settings, 'changed::tray-icons-dedup-bg-apps', () => {
      this._dedupBgApps = settings.get_boolean('tray-icons-dedup-bg-apps');
      if (this._dedupBgApps) {
        for (const [appId, entry] of [...this._bgItemAppIds]) {
          this._sniCoversApp(appId, entry.app)
            .then((covered) => {
              if (covered) {
                this._bgItemAppIds.delete(appId);
                this._container?.removeItem(entry.itemId);
              }
            })
            .catch(() => {});
        }
      }
    });
    this._lifecycle.connect(settings, 'changed::tray-icons-hide-bg-quick-settings', () => {
      if (settings.get_boolean('tray-icons-hide-bg-quick-settings')) {
        this._hideBgAppsQuickSettings();
      } else {
        this._restoreBgAppsQuickSettings();
      }
    });
    this._lifecycle.connect(settings, 'changed::tray-icons-recolor-symbolic-pixmaps', () => {
      logger.debug(
        `Recolor symbolic SNI pixmaps=${settings.get_boolean('tray-icons-recolor-symbolic-pixmaps')}; refreshing SNI icons`,
        { prefix: LOG_PREFIX },
      );
      this._sniHost?.refreshIcons('recolor-setting');
    });
  }

  override disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._desktopSettings = null;

    this._restoreBgAppsQuickSettings();

    this._bgSource?.destroy();
    this._bgSource = null;
    this._bgItemAppIds.clear();

    this._sniHost?.destroy();
    this._sniHost = null;

    this._sniWatcher?.destroy();
    this._sniWatcher = null;

    this._container?.destroy();
    this._container = null;
  }

  private _onSniItemAdded(item: TrayItem): void {
    logger.debug(`SNI item added: ${item.id} (menuBus=${item.menuBusName ?? 'none'})`, {
      prefix: LOG_PREFIX,
    });
    this._container?.addItem(item);
    if (this._dedupBgApps) {
      this._removeBgItemsCoveredBySni().catch((e) =>
        logger.warn(`_removeBgItemsCoveredBySni failed: ${e}`, { prefix: LOG_PREFIX }),
      );
    }
  }

  private async _onBgItemAdded(item: TrayItem, appId: string, app: Shell.App): Promise<void> {
    logger.debug(`BG app detected: ${appId}`, { prefix: LOG_PREFIX });
    if (this._dedupBgApps && (await this._sniCoversApp(appId, app))) {
      logger.debug(`BG app ${appId} already covered by SNI, skipping`, { prefix: LOG_PREFIX });
      return;
    }
    if (!this._container) return;
    this._bgItemAppIds.set(appId, { itemId: item.id, app });
    this._container.addItem(item);
    logger.debug(`BG app ${appId} added to tray`, { prefix: LOG_PREFIX });
  }

  private async _getUniqueName(busName: string): Promise<string | null> {
    try {
      const res = await (Gio.DBus.session as any).call(
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus',
        'GetNameOwner',
        GLib.Variant.new('(s)', [busName]),
        new GLib.VariantType('(s)'),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );
      return res.get_child_value(0).unpack() as string;
    } catch {
      return null;
    }
  }

  private async _getConnectionPid(busName: string): Promise<number | null> {
    try {
      const res = await (Gio.DBus.session as any).call(
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus',
        'GetConnectionUnixProcessID',
        GLib.Variant.new('(s)', [busName]),
        new GLib.VariantType('(u)'),
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );
      return res.get_child_value(0).unpack() as number;
    } catch {
      return null;
    }
  }

  private async _sniCoversApp(appId: string, app: Shell.App): Promise<boolean> {
    const owner = await this._getUniqueName(appId);
    if (owner) {
      const covered = this._sniHost?.hasItemForBus(owner) ?? false;
      logger.debug(`SNI covers ${appId}? owner=${owner} covered=${covered}`, {
        prefix: LOG_PREFIX,
      });
      if (covered) return true;
    }

    const candidates = appIdCandidates([appId, app.get_id()]);
    for (const candidate of candidates) {
      if (candidate === appId) continue;
      const candidateOwner = await this._getUniqueName(candidate);
      if (!candidateOwner) continue;
      const covered = this._sniHost?.hasItemForBus(candidateOwner) ?? false;
      logger.debug(
        `SNI covers ${appId}? candidate=${candidate} owner=${candidateOwner} covered=${covered}`,
        {
          prefix: LOG_PREFIX,
        },
      );
      if (covered) return true;
    }

    const coveredByPid = await this._sniCoversAppPid(appId, app);
    if (coveredByPid) return true;

    const coveredByMetadata =
      [...candidates].some((candidate) => this._sniHost?.hasSniForAppId(candidate)) ?? false;
    logger.debug(`SNI covers ${appId}? owner=none, metadata-match=${coveredByMetadata}`, {
      prefix: LOG_PREFIX,
    });
    return coveredByMetadata;
  }

  private async _sniCoversAppPid(appId: string, app: Shell.App): Promise<boolean> {
    const candidates = appIdCandidates([appId, app.get_id()]);
    const appPids = app.get_pids?.() ?? [];
    if (appPids.length === 0) {
      logger.debug(`SNI covers ${appId}? pid-match=false app-pids=[]`, { prefix: LOG_PREFIX });
    }

    const appPidSet = new Set(appPids);
    for (const busName of this._sniHost?.getBusNames() ?? []) {
      const sniPid = await this._getConnectionPid(busName);
      if (!sniPid) continue;

      const directMatch = appPidSet.has(sniPid);
      const ancestorMatch = directMatch ? true : await this._pidHasAncestor(sniPid, appPidSet);
      const trackerMatch = this._trackedPidMatchesApp(sniPid, appId, app);
      const flatpakAppId = await this._getFlatpakAppId(sniPid);
      const flatpakMatch = flatpakAppId ? candidates.has(flatpakAppId.toLowerCase()) : false;
      const covered = ancestorMatch || trackerMatch || flatpakMatch;
      logger.debug(
        `SNI covers ${appId}? sni-bus=${busName} sni-pid=${sniPid} flatpak=${flatpakAppId ?? 'none'} app-pids=[${appPids.join(', ')}] pid-match=${covered}`,
        { prefix: LOG_PREFIX },
      );
      if (covered) return true;
    }

    return false;
  }

  private async _getFlatpakAppId(pid: number): Promise<string | null> {
    const text = await this._readProcText(`/proc/${pid}/root/.flatpak-info`);
    if (!text) return null;
    const match = /^name=(.+)$/m.exec(text);
    return match?.[1]?.trim() || null;
  }

  private async _readProcText(path: string): Promise<string | null> {
    try {
      const file = Gio.File.new_for_path(path);
      const [contents] = await file.load_contents_async(null);
      return new TextDecoder().decode(contents);
    } catch {
      return null;
    }
  }

  private _trackedPidMatchesApp(pid: number, appId: string, app: Shell.App): boolean {
    try {
      const trackedApp = Shell.WindowTracker.get_default().get_app_from_pid(pid);
      if (!trackedApp) return false;
      const trackedId = trackedApp.get_id();
      return appIdCandidates([appId, app.get_id()]).has(trackedId.toLowerCase());
    } catch {
      return false;
    }
  }

  private async _pidHasAncestor(pid: number, candidateAncestors: Set<number>): Promise<boolean> {
    let currentPid = pid;
    const seen = new Set<number>();

    while (currentPid > 1 && !seen.has(currentPid)) {
      seen.add(currentPid);
      const parentPid = await this._getParentPid(currentPid);
      if (!parentPid) return false;
      if (candidateAncestors.has(parentPid)) return true;
      currentPid = parentPid;
    }

    return false;
  }

  private async _getParentPid(pid: number): Promise<number | null> {
    const text = await this._readProcText(`/proc/${pid}/status`);
    if (!text) return null;
    const match = /^PPid:\s+(\d+)$/m.exec(text);
    if (!match) return null;
    return Number.parseInt(match[1]!, 10);
  }

  private async _removeBgItemsCoveredBySni(): Promise<void> {
    logger.debug(`Dedup: bg items: [${[...this._bgItemAppIds.keys()].join(', ')}]`, {
      prefix: LOG_PREFIX,
    });

    for (const [appId, entry] of [...this._bgItemAppIds]) {
      if (await this._sniCoversApp(appId, entry.app)) {
        logger.debug(`Removing bg:${appId} covered by SNI`, { prefix: LOG_PREFIX });
        this._bgItemAppIds.delete(appId);
        this._container?.removeItem(entry.itemId);
      }
    }
  }

  private _onItemRemoved(id: string): void {
    if (id.startsWith('bg:')) {
      this._bgItemAppIds.delete(id.replace('bg:', ''));
    }
    this._container?.removeItem(id);
  }

  private _onStatusChanged(id: string, status: TrayItemStatus): void {
    if (status === 'NeedsAttention') {
      this._container?.notifyAttention(id);
    } else {
      this._container?.clearAttentionBadge(id);
    }
  }

  private _hideBgAppsQuickSettings(): void {
    if (this._bgAppsToggle) {
      this._forceHideBgAppsToggle();
      return;
    }

    this._watchBgAppsQuickSettingsGrid();
    const toggle = this._findBgAppsQuickSettingsToggle();
    if (!toggle) {
      logger.debug('Background Apps quick settings toggle not found yet', { prefix: LOG_PREFIX });
      return;
    }

    this._bgAppsToggle = toggle;
    this._forceHideBgAppsToggle();
    toggle.connectObject(
      'notify::visible',
      () => this._forceHideBgAppsToggle(),
      'destroy',
      () => {
        this._bgAppsToggle = null;
      },
      this,
    );
    logger.debug('Background Apps quick settings toggle hidden', { prefix: LOG_PREFIX });
  }

  private _findBgAppsQuickSettingsToggle(): any {
    const quickSettings = Main.panel.statusArea.quickSettings as any;
    const backgroundAppsItem = quickSettings?._backgroundApps?.quickSettingsItems?.find(
      (item: any) => this._isBgAppsQuickSettingsToggle(item),
    );
    if (backgroundAppsItem) return backgroundAppsItem;

    return this._findBgAppsQuickSettingsToggleInActor(getQuickSettingsGrid());
  }

  private _findBgAppsQuickSettingsToggleInActor(actor: any): any {
    if (!actor) return null;
    if (this._isBgAppsQuickSettingsToggle(actor)) return actor;

    for (const child of actor.get_children?.() ?? []) {
      const match = this._findBgAppsQuickSettingsToggleInActor(child);
      if (match) return match;
    }

    return null;
  }

  private _isBgAppsQuickSettingsToggle(actor: any): boolean {
    return actor?.has_style_class_name?.('background-apps-quick-toggle') === true;
  }

  private _watchBgAppsQuickSettingsGrid(): void {
    const grid = getQuickSettingsGrid();
    if (!grid) return;
    if (this._bgAppsGrid === grid) return;

    this._unwatchBgAppsQuickSettingsGrid();
    this._bgAppsGrid = grid;
    grid.connectObject(
      'child-added',
      () => this._hideBgAppsQuickSettings(),
      'destroy',
      () => {
        if (this._bgAppsGrid === grid) this._bgAppsGrid = null;
      },
      this,
    );
  }

  private _unwatchBgAppsQuickSettingsGrid(): void {
    if (!this._bgAppsGrid) return;
    this._bgAppsGrid.disconnectObject(this);
    this._bgAppsGrid = null;
  }

  private _forceHideBgAppsToggle(): void {
    if (!this._bgAppsToggle) return;
    if (this._bgAppsToggle.visible) this._bgAppsToggle.visible = false;
  }

  private _restoreBgAppsQuickSettings(): void {
    this._unwatchBgAppsQuickSettingsGrid();
    if (!this._bgAppsToggle) return;
    this._bgAppsToggle.disconnectObject(this);
    this._bgAppsToggle._syncVisibility();
    this._bgAppsToggle = null;
  }
}
