// src/modules/trayIcons/trayIcons.ts
import '@girs/gjs';
import { gettext as _ } from 'gettext';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
import type { Button as PanelMenuButton } from '@girs/gnome-shell/ui/panelMenu';

// @ts-ignore
Gio._promisify(Gio.DBusConnection.prototype, 'call');

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';

import { TrayContainer } from './trayContainer.ts';
import { BackgroundAppsSource } from './backgroundAppsSource.ts';
import { SniWatcher } from './sniWatcher.ts';
import { SniHost } from './sniHost.ts';
import type { TrayItem, TrayItemStatus } from './trayState.ts';

const PANEL_INDICATOR_ID = 'aurora-tray-icons';
const LOG_PREFIX = 'AuroraTray';

export class TrayIcons extends Module {
  private _container: TrayContainer | null = null;
  private _sniWatcher: SniWatcher | null = null;
  private _sniHost: SniHost | null = null;
  private _bgSource: BackgroundAppsSource | null = null;
  private _settingsChangedIds: number[] = [];
  private _bgItemAppIds = new Map<string, string>(); // appId → item.id
  private _dedupBgApps = true;
  private _bgAppsToggle: any = null;
  private _bgAppsToggleVisibleId = 0;
  private _desktopSettings: SettingsManager | null = null;
  private _desktopSettingsChangedId = 0;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
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

    // SNI layer
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
    this._desktopSettingsChangedId = this._desktopSettings.connect('changed::color-scheme', () => {
      const scheme = this._desktopSettings?.getString('color-scheme') ?? 'unknown';
      logger.log(`Color scheme changed to ${scheme}; refreshing SNI icons`, {
        prefix: LOG_PREFIX,
      });
      this._sniHost?.refreshIcons('color-scheme');
    });

    // Background Apps layer
    this._bgSource = new BackgroundAppsSource({
      onItemAdded: (item) => this._onBgItemAdded(item).catch(() => {}),
      onItemRemoved: (id) => this._onItemRemoved(id),
    });
    this._bgSource
      .start()
      .catch((e) => logger.warn(`bg source start failed: ${e}`, { prefix: LOG_PREFIX }));

    // Settings change listeners
    this._settingsChangedIds.push(
      settings.connect('changed::tray-icons-limit', () => {
        this._container?.setLimit(settings.get_int('tray-icons-limit'));
      }),
      settings.connect('changed::tray-icons-icon-size', () => {
        this._container?.setIconSize(settings.get_int('tray-icons-icon-size'));
      }),
      settings.connect('changed::tray-icons-attention-timeout', () => {
        this._container?.setAttentionTimeout(settings.get_int('tray-icons-attention-timeout'));
      }),
      settings.connect('changed::tray-icons-dedup-bg-apps', () => {
        this._dedupBgApps = settings.get_boolean('tray-icons-dedup-bg-apps');
        if (this._dedupBgApps) {
          for (const [appId, itemId] of [...this._bgItemAppIds]) {
            this._sniCoversApp(appId)
              .then((covered) => {
                if (covered) {
                  this._bgItemAppIds.delete(appId);
                  this._container?.removeItem(itemId);
                }
              })
              .catch(() => {});
          }
        }
      }),
      settings.connect('changed::tray-icons-hide-bg-quick-settings', () => {
        if (settings.get_boolean('tray-icons-hide-bg-quick-settings')) {
          this._hideBgAppsQuickSettings();
        } else {
          this._restoreBgAppsQuickSettings();
        }
      }),
      settings.connect('changed::tray-icons-recolor-symbolic-pixmaps', () => {
        logger.log(
          `Recolor symbolic SNI pixmaps=${settings.get_boolean('tray-icons-recolor-symbolic-pixmaps')}; refreshing SNI icons`,
          { prefix: LOG_PREFIX },
        );
        this._sniHost?.refreshIcons('recolor-setting');
      }),
    );
  }

  private _onSniItemAdded(item: TrayItem): void {
    logger.log(`SNI item added: ${item.id} (menuBus=${item.menuBusName ?? 'none'})`, {
      prefix: LOG_PREFIX,
    });
    this._container?.addItem(item);
    if (this._dedupBgApps && item.menuBusName) {
      this._removeBgItemCoveredBy(item.menuBusName).catch((e) =>
        logger.warn(`_removeBgItemCoveredBy failed: ${e}`, { prefix: LOG_PREFIX }),
      );
    }
  }

  private async _onBgItemAdded(item: TrayItem): Promise<void> {
    const appId = item.id.replace('bg:', '');
    logger.log(`BG app detected: ${appId}`, { prefix: LOG_PREFIX });
    if (this._dedupBgApps && (await this._sniCoversApp(appId))) {
      logger.log(`BG app ${appId} already covered by SNI, skipping`, { prefix: LOG_PREFIX });
      return;
    }
    if (!this._container) return;
    this._bgItemAppIds.set(appId, item.id);
    this._container.addItem(item);
    logger.log(`BG app ${appId} added to tray`, { prefix: LOG_PREFIX });
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

  private async _sniCoversApp(appId: string): Promise<boolean> {
    const owner = await this._getUniqueName(appId);
    if (owner) {
      const covered = this._sniHost?.hasItemForBus(owner) ?? false;
      logger.log(`SNI covers ${appId}? owner=${owner} covered=${covered}`, {
        prefix: LOG_PREFIX,
      });
      return covered;
    }
    // Fallback: app doesn't own its expected D-Bus name (common for Flatpak Qt/SNI apps).
    // Match by the SNI item's Id property instead.
    const coveredById = this._sniHost?.hasSniForAppId(appId) ?? false;
    logger.log(`SNI covers ${appId}? owner=none, Id-match=${coveredById}`, {
      prefix: LOG_PREFIX,
    });
    return coveredById;
  }

  private async _removeBgItemCoveredBy(sniBusName: string): Promise<void> {
    // Resolve to unique name so comparison works regardless of whether
    // the SNI app registered with a well-known or unique bus name.
    const sniUnique = sniBusName.startsWith(':')
      ? sniBusName
      : await this._getUniqueName(sniBusName);

    if (!sniUnique) {
      logger.log(`Cannot resolve SNI bus ${sniBusName}, skip bg dedup`, { prefix: LOG_PREFIX });
      return;
    }

    logger.log(
      `Dedup: SNI ${sniBusName} (unique=${sniUnique}), bg items: [${[...this._bgItemAppIds.keys()].join(', ')}]`,
      { prefix: LOG_PREFIX },
    );

    for (const [appId, itemId] of this._bgItemAppIds) {
      const owner = await this._getUniqueName(appId);
      logger.log(`Dedup: bg ${appId} owner=${owner ?? 'none'}`, { prefix: LOG_PREFIX });
      if (owner === sniUnique) {
        logger.log(`Removing bg:${appId} covered by SNI ${sniBusName}`, { prefix: LOG_PREFIX });
        this._bgItemAppIds.delete(appId);
        this._container?.removeItem(itemId);
        return;
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
    if (this._bgAppsToggle) return;
    const grid = (Main.panel.statusArea.quickSettings as any)?.menu?._grid;
    if (!grid) return;
    for (const child of grid.get_children()) {
      if ((child as any).has_style_class_name?.('background-apps-quick-toggle')) {
        this._bgAppsToggle = child;
        child.visible = false;
        this._bgAppsToggleVisibleId = child.connect('notify::visible', () => {
          if (child.visible) child.visible = false;
        });
        break;
      }
    }
  }

  private _restoreBgAppsQuickSettings(): void {
    if (!this._bgAppsToggle) return;
    if (this._bgAppsToggleVisibleId) {
      this._bgAppsToggle.disconnect(this._bgAppsToggleVisibleId);
      this._bgAppsToggleVisibleId = 0;
    }
    this._bgAppsToggle._syncVisibility?.();
    this._bgAppsToggle = null;
  }

  override disable(): void {
    const settings = this.context.settings.getRawSettings();
    for (const id of this._settingsChangedIds) {
      settings.disconnect(id);
    }
    this._settingsChangedIds = [];
    if (this._desktopSettings && this._desktopSettingsChangedId > 0) {
      this._desktopSettings.disconnect(this._desktopSettingsChangedId);
      this._desktopSettingsChangedId = 0;
    }
    this._desktopSettings = null;

    this._restoreBgAppsQuickSettings();

    this._bgSource?.destroy();
    this._bgSource = null;
    this._bgItemAppIds.clear();

    this._sniHost?.destroy();
    this._sniHost = null;

    this._sniWatcher?.destroy();
    this._sniWatcher = null;

    (Main.panel.statusArea as Record<string, unknown>)[PANEL_INDICATOR_ID] = null;
    this._container?.destroy();
    this._container = null;
  }
}

export const definition: ModuleDefinition = {
  key: 'tray-icons',
  settingsKey: 'module-tray-icons',
  title: _('Tray Icons'),
  subtitle: _('System tray with SNI and background app icons'),
  options: [
    {
      key: 'tray-icons-limit',
      title: _('Visible Icon Limit'),
      subtitle: _('Maximum number of icons shown before the expand button appears'),
      type: 'spin',
      min: 1,
      max: 20,
    },
    {
      key: 'tray-icons-icon-size',
      title: _('Icon Size'),
      subtitle: _('Tray icon size in pixels (14–24)'),
      type: 'spin',
      min: 14,
      max: 24,
    },
    {
      key: 'tray-icons-attention-timeout',
      title: _('Attention Auto-Collapse (seconds)'),
      subtitle: _('Seconds before the tray collapses after a notification icon appears'),
      type: 'spin',
      min: 1,
      max: 30,
    },
    {
      key: 'tray-icons-dedup-bg-apps',
      title: _('Hide Background App When Tray Icon Present'),
      subtitle: _('Remove the background app icon when the same app has an SNI tray icon'),
      type: 'switch',
    },
    {
      key: 'tray-icons-hide-bg-quick-settings',
      title: _('Hide Background Apps from Quick Settings'),
      subtitle: _('Hide the Background Apps section from the Quick Settings dropdown'),
      type: 'switch',
    },
    {
      key: 'tray-icons-recolor-symbolic-pixmaps',
      title: _('Recolor Symbolic Tray Icons'),
      subtitle: _('Automatically recolor monochrome SNI icons to match the panel theme'),
      type: 'switch',
    },
  ],
  factory: (ctx) => new TrayIcons(ctx),
};
