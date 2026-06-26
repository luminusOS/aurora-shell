import '@girs/gjs';
import { gettext as _ } from 'gettext';

import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PanelMenu from '@girs/gnome-shell/ui/panelMenu';
import type { Button as PanelMenuButton } from '@girs/gnome-shell/ui/panelMenu';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';
import { loadIcon } from '~/shared/icons.ts';

const LOG_PREFIX = 'AuroraMenu';
const STATUS_AREA_ID = 'aurora-menu';
const APP_STORE_COMMAND_KEY = 'aurora-menu-app-store-command';
const MENU_ICON_KEY = 'aurora-menu-icon';
const CUSTOM_ENABLED_KEY = 'aurora-menu-custom-item-enabled';
const CUSTOM_LABEL_KEY = 'aurora-menu-custom-item-label';
const CUSTOM_COMMAND_KEY = 'aurora-menu-custom-item-command';
const HIDE_ACTIVITIES_KEY = 'aurora-menu-hide-activities';
const RECENT_LIMIT = 10;
const MENU_WIDTH = 280;
const RECENT_LABEL_LIMIT = 48;
const RECENT_LABEL_WIDTH = 180;

const MENU_ICONS = {
  aurora: { iconName: 'aurora-shell-menu-symbolic' },
  gnome: { iconName: 'start-here-symbolic' },
  luminus: { iconName: 'luminus-os-symbolic' },
} as const;

type MenuIconKey = keyof typeof MENU_ICONS;

// @ts-ignore — _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.File.prototype, 'load_bytes_async');
// @ts-ignore
Gio._promisify(Gio.File.prototype, 'query_info_async');

type MenuCommand = {
  title: string;
  argv: string[];
  iconName: string;
};

type RecentItem = {
  title: string;
  uri: string;
  modified: number;
  iconName: string;
};

type RecentSubmenuItem = PopupMenu.PopupSubMenuMenuItem & {
  _triangleBin?: St.Widget;
};

export class AuroraMenu extends Module {
  private _button: PanelMenu.Button | null = null;
  private _panelIcon: St.Icon | null = null;
  private _settingsIds: number[] = [];
  private _menuOpenStateId = 0;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();

    this._button = new PanelMenu.Button(0.0, 'Aurora Menu');
    this._button.add_style_class_name('aurora-menu-button');
    this._panelIcon = new St.Icon({
      style_class: 'system-status-icon aurora-menu-panel-icon',
    });
    this._syncPanelIcon();
    this._button.add_child(this._panelIcon);

    const menu = this._getMenu();
    menu?.actor?.add_style_class_name('aurora-menu');
    menu?.setSourceAlignment?.(0.0);
    if (menu) this._lockMenuWidth(menu);

    this._menuOpenStateId =
      menu?.connect('open-state-changed', (_menu, open) => {
        if (open) this._rebuildMenu();
        return undefined;
      }) ?? 0;

    this._settingsIds = [
      this.context.settings.connect(`changed::${MENU_ICON_KEY}`, () => this._syncPanelIcon()),
      this.context.settings.connect(`changed::${APP_STORE_COMMAND_KEY}`, () => this._rebuildMenu()),
      this.context.settings.connect(`changed::${CUSTOM_ENABLED_KEY}`, () => this._rebuildMenu()),
      this.context.settings.connect(`changed::${CUSTOM_LABEL_KEY}`, () => this._rebuildMenu()),
      this.context.settings.connect(`changed::${CUSTOM_COMMAND_KEY}`, () => this._rebuildMenu()),
      this.context.settings.connect(`changed::${HIDE_ACTIVITIES_KEY}`, () =>
        this._syncActivitiesButton(),
      ),
    ];

    this._syncActivitiesButton();
    this._rebuildMenu();
    Main.panel.addToStatusArea(
      STATUS_AREA_ID,
      this._button as unknown as PanelMenuButton,
      0,
      'left',
    );
  }

  override disable(): void {
    for (const id of this._settingsIds) this.context.settings.disconnect(id);
    this._settingsIds = [];

    if (this._menuOpenStateId && this._button) {
      this._getMenu()?.disconnect(this._menuOpenStateId);
      this._menuOpenStateId = 0;
    }

    this._showActivitiesButton();
    (Main.panel.statusArea as Record<string, unknown>)[STATUS_AREA_ID] = null;
    this._panelIcon?.destroy();
    this._panelIcon = null;
    this._button?.destroy();
    this._button = null;
  }

  private _rebuildMenu(): void {
    this._rebuildMenuAsync().catch((e) =>
      logger.warn(`Failed to rebuild Aurora Menu: ${e}`, { prefix: LOG_PREFIX }),
    );
  }

  private async _rebuildMenuAsync(): Promise<void> {
    const menu = this._getMenu();
    if (!menu) return;

    menu.removeAll();
    this._lockMenuWidth(menu);

    this._addCommand(menu, {
      title: _('About This PC'),
      argv: ['gnome-control-center', 'about'],
      iconName: 'help-about-symbolic',
    });
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._addCommand(menu, {
      title: _('Home Folder'),
      argv: ['xdg-open', GLib.get_home_dir()],
      iconName: 'user-home-symbolic',
    });
    this._addCommand(menu, {
      title: _('Downloads'),
      argv: ['xdg-open', getDownloadsDirectory() ?? GLib.get_home_dir()],
      iconName: 'folder-download-symbolic',
    });
    await this._addRecentItems(menu);
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._addCommand(menu, {
      title: _('System Settings'),
      argv: ['gnome-control-center'],
      iconName: 'emblem-system-symbolic',
    });
    this._addCommand(menu, {
      title: _('Software'),
      argv: this._parseCommand(APP_STORE_COMMAND_KEY, ['gnome-software']),
      iconName: 'system-software-install-symbolic',
    });
    this._addCommand(menu, {
      title: _('Extensions'),
      argv: ['gnome-extensions-app'],
      iconName: 'application-x-addon-symbolic',
    });
    this._addCustomItem(menu);
  }

  private _addCommand(menu: PopupMenu.PopupMenu, command: MenuCommand): void {
    const item = new PopupMenu.PopupMenuItem(command.title);
    this._decorateItem(item, command.iconName);
    item.connect('activate', () => this._spawn(command.argv));
    menu.addMenuItem(item);
  }

  private _addCustomItem(menu: PopupMenu.PopupMenu): void {
    if (!this.context.settings.getBoolean(CUSTOM_ENABLED_KEY)) return;

    const label = this.context.settings.getString(CUSTOM_LABEL_KEY).trim();
    const argv = this._parseCommand(CUSTOM_COMMAND_KEY, []);
    if (!label || argv.length === 0) return;

    this._addCommand(menu, {
      title: label,
      argv,
      iconName: 'application-x-executable-symbolic',
    });
  }

  private async _addRecentItems(menu: PopupMenu.PopupMenu): Promise<void> {
    const submenu = new PopupMenu.PopupSubMenuMenuItem(
      _('Recent Items'),
      true,
    ) as RecentSubmenuItem;
    if (submenu.icon) submenu.icon.icon_name = 'document-open-recent-symbolic';
    this._replaceSubmenuArrow(submenu);
    this._lockSubmenuWidth(submenu);

    const items = await this._readRecentItems();

    if (items.length === 0) {
      const empty = new PopupMenu.PopupMenuItem(_('No recent items'));
      empty.setSensitive(false);
      submenu.menu.addMenuItem(empty);
      menu.addMenuItem(submenu);
      return;
    }

    for (const item of items) {
      const recent = new PopupMenu.PopupMenuItem(truncateMiddle(item.title, RECENT_LABEL_LIMIT));
      this._decorateItem(recent, item.iconName);
      this._constrainMenuItemLabel(recent);
      recent.connect('activate', () => this._openUri(item.uri));
      submenu.menu.addMenuItem(recent);
    }

    menu.addMenuItem(submenu);
  }

  private async _readRecentItems(): Promise<RecentItem[]> {
    const file = Gio.File.new_for_path(
      GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']),
    );

    try {
      await file.query_info_async(
        'standard::type',
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT,
        null,
      );

      const [bytes] = await file.load_bytes_async(null);
      const data = bytes.get_data();
      if (!data) return [];

      const text = new TextDecoder().decode(data);
      const items: RecentItem[] = [];
      const seen = new Set<string>();
      const bookmarkRegex =
        /<bookmark\b[^>]*href="([^"]+)"[^>]*modified="([^"]+)"[^>]*>([\s\S]*?)<\/bookmark>/g;

      let match: RegExpExecArray | null;
      while ((match = bookmarkRegex.exec(text)) !== null) {
        const uri = decodeXml(match[1] ?? '');
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);

        const body = match[3] ?? '';
        const title = this._extractRecentTitle(body, uri);
        const modified = parseIsoTime(match[2] ?? '');
        items.push({
          title,
          uri,
          modified,
          iconName: uri.startsWith('file://') ? 'text-x-generic-symbolic' : 'emblem-web-symbolic',
        });
      }

      return items.sort((a, b) => b.modified - a.modified).slice(0, RECENT_LIMIT);
    } catch (e) {
      if (isGioError(e, Gio.IOErrorEnum.NOT_FOUND)) return [];

      logger.warn(`Failed to read recent items: ${e}`, { prefix: LOG_PREFIX });
      return [];
    }
  }

  private _extractRecentTitle(bookmarkBody: string, uri: string): string {
    const title = /<title>([\s\S]*?)<\/title>/.exec(bookmarkBody)?.[1]?.trim();
    if (title) return decodeXml(title);

    const decodedUri = GLib.uri_unescape_string(uri, null) ?? uri;
    if (decodedUri.startsWith('file://')) return GLib.path_get_basename(decodedUri.slice(7));
    return decodedUri;
  }

  private _decorateItem(item: PopupMenu.PopupMenuItem, iconName: string): void {
    const icon = new St.Icon({
      icon_name: iconName,
      style_class: 'popup-menu-icon',
      y_align: Clutter.ActorAlign.CENTER,
    });
    item.insert_child_at_index(icon, 0);
  }

  private _replaceSubmenuArrow(item: RecentSubmenuItem): void {
    item._triangleBin?.hide();

    const arrow = new St.Icon({
      icon_name: 'go-down-symbolic',
      style_class: 'popup-menu-arrow',
      y_align: Clutter.ActorAlign.CENTER,
    });
    item.add_child(arrow);
    const setSubmenuShown = item.setSubmenuShown.bind(item);
    item.setSubmenuShown = (open: boolean) => {
      arrow.icon_name = open ? 'go-up-symbolic' : 'go-down-symbolic';
      setSubmenuShown(open);
    };
  }

  private _lockMenuWidth(menu: PopupMenu.PopupMenu): void {
    menu.box.set_width(MENU_WIDTH);
  }

  private _lockSubmenuWidth(item: PopupMenu.PopupSubMenuMenuItem): void {
    item.menu.actor.set_width(MENU_WIDTH);
    item.menu.box.set_width(MENU_WIDTH);
  }

  private _constrainMenuItemLabel(item: PopupMenu.PopupMenuItem): void {
    item.label.set_width(RECENT_LABEL_WIDTH);
    item.label.clutter_text.set_single_line_mode(true);
    item.label.clutter_text.set_line_wrap(false);
    item.label.clutter_text.ellipsize = 3;
  }

  private _syncPanelIcon(): void {
    if (!this._panelIcon) return;

    const requested = this.context.settings.getString(MENU_ICON_KEY);
    const iconKey = isMenuIconKey(requested) ? requested : 'aurora';
    const icon = MENU_ICONS[iconKey];

    this._panelIcon.icon_name = null;
    this._panelIcon.gicon = loadIcon(icon.iconName);
  }

  private _spawn(argv: string[]): void {
    try {
      Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
      logger.warn(`Failed to spawn command "${argv.join(' ')}": ${e}`, { prefix: LOG_PREFIX });
      Main.notifyError(_('Aurora Menu'), _('Could not launch the selected command.'));
    } finally {
      this._getMenu()?.close();
    }
  }

  private _openUri(uri: string): void {
    try {
      const context = global.create_app_launch_context(0, -1);
      Gio.AppInfo.launch_default_for_uri(uri, context);
    } catch (e) {
      logger.warn(`Failed to open recent item "${uri}": ${e}`, { prefix: LOG_PREFIX });
      Main.notifyError(_('Aurora Menu'), _('Could not open the selected recent item.'));
    } finally {
      this._getMenu()?.close();
    }
  }

  private _parseCommand(key: string, fallback: string[]): string[] {
    const raw = this.context.settings.getString(key).trim();
    if (!raw) return fallback;

    try {
      const [ok, argv] = GLib.shell_parse_argv(raw);
      if (ok && argv && argv.length > 0) return argv;
    } catch (e) {
      logger.warn(`Invalid command in ${key}: ${e}`, { prefix: LOG_PREFIX });
    }

    return fallback;
  }

  private _syncActivitiesButton(): void {
    const actor = this._getActivitiesActor();
    if (!actor) return;

    if (this.context.settings.getBoolean(HIDE_ACTIVITIES_KEY)) actor.hide();
    else actor.show();
  }

  private _showActivitiesButton(): void {
    this._getActivitiesActor()?.show();
  }

  private _getActivitiesActor(): St.Widget | null {
    const statusArea = Main.panel.statusArea as Record<string, any>;
    const entry = statusArea['activities'] ?? statusArea['activitiesButton'];
    return (entry?.container ?? entry ?? null) as St.Widget | null;
  }

  private _getMenu(): PopupMenu.PopupMenu | null {
    return (this._button?.menu as PopupMenu.PopupMenu | null | undefined) ?? null;
  }
}

function parseIsoTime(value: string): number {
  const dateTime = GLib.DateTime.new_from_iso8601(value, null);
  return dateTime?.to_unix() ?? 0;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function isGioError(error: unknown, code: number): boolean {
  return Boolean(
    (error as { matches?: (domain: unknown, code: unknown) => boolean })?.matches?.(
      Gio.IOErrorEnum,
      code,
    ),
  );
}

function getDownloadsDirectory(): string | null {
  const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD);
  return path || null;
}

function isMenuIconKey(value: string): value is MenuIconKey {
  return value in MENU_ICONS;
}

function truncateMiddle(value: string, limit: number): string {
  if (value.length <= limit) return value;

  const edgeLength = Math.max(1, Math.floor((limit - 1) / 2));
  return `${value.slice(0, edgeLength)}…${value.slice(value.length - edgeLength)}`;
}

export const definition: ModuleDefinition = {
  key: 'aurora-menu',
  settingsKey: 'module-aurora-menu',
  section: 'dock-panel',
  title: _('Aurora Menu'),
  subtitle: _('Aurora panel menu with recent items and useful shortcuts'),
  options: [
    {
      key: MENU_ICON_KEY,
      title: _('Menu Icon'),
      subtitle: _('Choose the icon shown in the top panel'),
      type: 'icon-select',
      choices: [
        {
          value: 'aurora',
          title: _('Aurora Shell'),
          iconName: 'aurora-shell-menu-symbolic',
        },
        {
          value: 'gnome',
          title: _('GNOME'),
          iconName: 'start-here-symbolic',
        },
        {
          value: 'luminus',
          title: _('Luminus OS'),
          iconName: 'luminus-os-symbolic',
        },
      ],
    },
    {
      key: HIDE_ACTIVITIES_KEY,
      title: _('Hide Activities Button'),
      subtitle: _('Hide the Activities button while Aurora Menu is enabled'),
      type: 'switch',
    },
    {
      key: APP_STORE_COMMAND_KEY,
      title: _('Software Command'),
      subtitle: _('Command used by the Software menu item'),
      type: 'entry',
    },
    {
      key: CUSTOM_ENABLED_KEY,
      title: _('Custom Menu Item'),
      subtitle: _('Show one additional command in Aurora Menu'),
      type: 'switch',
    },
    {
      key: CUSTOM_LABEL_KEY,
      title: _('Custom Item Label'),
      subtitle: _('Text shown for the custom menu item'),
      type: 'entry',
    },
    {
      key: CUSTOM_COMMAND_KEY,
      title: _('Custom Item Command'),
      subtitle: _('Command launched by the custom menu item'),
      type: 'entry',
    },
  ],
  factory: (ctx) => new AuroraMenu(ctx),
};
