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
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import { loadIcon } from '~/shared/icons.ts';
import {
  decodeXml,
  parseCustomCommand,
  truncateMiddle,
  type CustomMenuCommand,
} from '~/panel/auroraMenuState.ts';

const LOG_PREFIX = 'AuroraMenu';
const STATUS_AREA_ID = 'aurora-menu';
const APP_STORE_COMMAND_KEY = 'aurora-menu-app-store-command';
const MENU_ICON_KEY = 'aurora-menu-icon';
const CUSTOM_ENABLED_KEY = 'aurora-menu-custom-item-enabled';
const CUSTOM_LABEL_KEY = 'aurora-menu-custom-item-label';
const CUSTOM_COMMAND_KEY = 'aurora-menu-custom-item-command';
const CUSTOM_ITEMS_KEY = 'aurora-menu-custom-items';
const HIDE_ACTIVITIES_KEY = 'aurora-menu-hide-activities';
const SHOW_ABOUT_KEY = 'aurora-menu-show-about';
const SHOW_HOME_KEY = 'aurora-menu-show-home';
const SHOW_DOWNLOADS_KEY = 'aurora-menu-show-downloads';
const SHOW_RECENT_KEY = 'aurora-menu-show-recent-items';
const SHOW_SETTINGS_KEY = 'aurora-menu-show-settings';
const SHOW_SOFTWARE_KEY = 'aurora-menu-show-software';
const SHOW_EXTENSIONS_KEY = 'aurora-menu-show-extensions';
const RECENT_LIMIT = 10;
const MENU_WIDTH = 280;
const RECENT_LABEL_LIMIT = 48;
const RECENT_LABEL_WIDTH = 180;
const EXTENSION_MANAGER_FLATPAK_ID = 'com.mattjakeman.ExtensionManager';
const EXTENSION_MANAGER_DESKTOP_ID = `${EXTENSION_MANAGER_FLATPAK_ID}.desktop`;

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
  iconName: string;
  argv?: string[];
  activate?: () => void;
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
  private _lifecycle: LifecycleScope | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._lifecycle = new LifecycleScope();

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

    if (menu) {
      const menuOpenStateId = menu.connect('open-state-changed', (_menu, open) => {
        if (open) this._rebuildMenu();
        return undefined;
      });
      this._lifecycle.onDispose(() => menu.disconnect(menuOpenStateId));
    }

    const settings = this.context.settings;
    const rebuildMenu = () => this._rebuildMenu();
    this._lifecycle.connect(settings, `changed::${MENU_ICON_KEY}`, () => this._syncPanelIcon());
    this._lifecycle.connect(settings, `changed::${APP_STORE_COMMAND_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${CUSTOM_ITEMS_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${CUSTOM_ENABLED_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${CUSTOM_LABEL_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${CUSTOM_COMMAND_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${SHOW_ABOUT_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${SHOW_HOME_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${SHOW_DOWNLOADS_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${SHOW_RECENT_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${SHOW_SETTINGS_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${SHOW_SOFTWARE_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${SHOW_EXTENSIONS_KEY}`, rebuildMenu);
    this._lifecycle.connect(settings, `changed::${HIDE_ACTIVITIES_KEY}`, () =>
      this._syncActivitiesButton(),
    );

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
    this._lifecycle?.dispose();
    this._lifecycle = null;

    this._showActivitiesButton();
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

    let hasItems = this._addCommandIfVisible(menu, SHOW_ABOUT_KEY, {
      title: _('About This PC'),
      argv: ['gnome-control-center', 'about'],
      iconName: 'help-about-symbolic',
    });

    const filesAdded = await this._addSection(menu, hasItems, [
      () =>
        this._addCommandIfVisible(menu, SHOW_HOME_KEY, {
          title: _('Home Folder'),
          argv: ['xdg-open', GLib.get_home_dir()],
          iconName: 'user-home-symbolic',
        }),
      () =>
        this._addCommandIfVisible(menu, SHOW_DOWNLOADS_KEY, {
          title: _('Downloads'),
          argv: ['xdg-open', this._getDownloadsDirectory() ?? GLib.get_home_dir()],
          iconName: 'folder-download-symbolic',
        }),
      () => this._addRecentItems(menu),
    ]);
    hasItems ||= filesAdded;

    const systemAdded = await this._addSection(menu, hasItems, [
      () =>
        this._addCommandIfVisible(menu, SHOW_SETTINGS_KEY, {
          title: _('System Settings'),
          argv: ['gnome-control-center'],
          iconName: 'emblem-system-symbolic',
        }),
      () =>
        this._addCommandIfVisible(menu, SHOW_SOFTWARE_KEY, {
          title: _('Software'),
          argv: this._parseCommand(APP_STORE_COMMAND_KEY, ['gnome-software']),
          iconName: 'system-software-install-symbolic',
        }),
      () =>
        this._addCommandIfVisible(menu, SHOW_EXTENSIONS_KEY, {
          title: _('Extensions'),
          iconName: 'application-x-addon-symbolic',
          activate: () => this._openExtensionsManager(),
        }),
    ]);
    hasItems ||= systemAdded;

    await this._addSection(menu, hasItems, [() => this._addCustomItems(menu)]);
  }

  private _addCommand(menu: PopupMenu.PopupMenu, command: MenuCommand): void {
    const item = new PopupMenu.PopupMenuItem(command.title);
    this._decorateItem(item, command.iconName);
    item.connect('activate', () => {
      if (command.activate) command.activate();
      else if (command.argv) this._spawn(command.argv);
    });
    menu.addMenuItem(item);
  }

  private _addCommandIfVisible(
    menu: PopupMenu.PopupMenu,
    visibleKey: string,
    command: MenuCommand,
  ): boolean {
    if (!this.context.settings.getBoolean(visibleKey)) return false;

    this._addCommand(menu, command);
    return true;
  }

  private async _addSection(
    menu: PopupMenu.PopupMenu,
    hasPreviousItems: boolean,
    builders: Array<() => boolean | Promise<boolean>>,
  ): Promise<boolean> {
    let separator: PopupMenu.PopupSeparatorMenuItem | null = null;
    let added = false;

    for (const build of builders) {
      if (hasPreviousItems && !separator) {
        separator = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(separator);
      }

      if (await build()) added = true;
    }

    if (!added && separator) separator.destroy();
    return added;
  }

  private _addCustomItems(menu: PopupMenu.PopupMenu): boolean {
    const commands = this._readCustomCommands();
    let added = false;

    for (const command of commands) {
      const argv = this._parseCommandLine(command.command, CUSTOM_ITEMS_KEY);
      if (argv.length === 0) continue;

      this._addCommand(menu, {
        title: command.label,
        argv,
        iconName: 'application-x-executable-symbolic',
      });
      added = true;
    }

    return added;
  }

  private async _addRecentItems(menu: PopupMenu.PopupMenu): Promise<boolean> {
    if (!this.context.settings.getBoolean(SHOW_RECENT_KEY)) return false;

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
      return true;
    }

    for (const item of items) {
      const recent = new PopupMenu.PopupMenuItem(truncateMiddle(item.title, RECENT_LABEL_LIMIT));
      this._decorateItem(recent, item.iconName);
      this._constrainMenuItemLabel(recent);
      recent.connect('activate', () => this._openUri(item.uri));
      submenu.menu.addMenuItem(recent);
    }

    menu.addMenuItem(submenu);
    return true;
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
        const modified = this._parseIsoTime(match[2] ?? '');
        items.push({
          title,
          uri,
          modified,
          iconName: uri.startsWith('file://') ? 'text-x-generic-symbolic' : 'emblem-web-symbolic',
        });
      }

      return items.sort((a, b) => b.modified - a.modified).slice(0, RECENT_LIMIT);
    } catch (e) {
      if (this._isGioError(e, Gio.IOErrorEnum.NOT_FOUND)) return [];

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
    const iconKey = this._isMenuIconKey(requested) ? requested : 'aurora';
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

  private _openExtensionsManager(): void {
    const command = this._findExtensionsManagerCommand();
    if (command) {
      this._spawn(command);
      return;
    }

    logger.warn('No installed GNOME Extensions manager command was found', { prefix: LOG_PREFIX });
    Main.notifyError(_('Aurora Menu'), _('Could not launch the selected command.'));
    this._getMenu()?.close();
  }

  private _findExtensionsManagerCommand(): string[] | null {
    if (GLib.find_program_in_path('gnome-extensions-app')) return ['gnome-extensions-app'];
    if (GLib.find_program_in_path('gnome-shell-extension-prefs'))
      return ['gnome-shell-extension-prefs'];
    if (
      GLib.find_program_in_path('flatpak') &&
      this._desktopFileExists(EXTENSION_MANAGER_DESKTOP_ID)
    )
      return ['flatpak', 'run', EXTENSION_MANAGER_FLATPAK_ID];

    return null;
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

    const argv = this._parseCommandLine(raw, key);
    return argv.length > 0 ? argv : fallback;
  }

  private _readCustomCommands(): CustomMenuCommand[] {
    const commands = this.context.settings
      .getStrv(CUSTOM_ITEMS_KEY)
      .map(parseCustomCommand)
      .filter((command): command is CustomMenuCommand => command !== null);

    if (commands.length > 0) return commands;
    if (!this.context.settings.getBoolean(CUSTOM_ENABLED_KEY)) return [];

    const label = this.context.settings.getString(CUSTOM_LABEL_KEY).trim();
    const command = this.context.settings.getString(CUSTOM_COMMAND_KEY).trim();
    if (!label || !command) return [];

    return [{ label, command }];
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

  private _parseIsoTime(value: string): number {
    const dateTime = GLib.DateTime.new_from_iso8601(value, null);
    return dateTime?.to_unix() ?? 0;
  }

  private _isGioError(error: unknown, code: number): boolean {
    return error instanceof GLib.Error && error.matches(Gio.io_error_quark(), code);
  }

  private _getDownloadsDirectory(): string | null {
    const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD);
    return path || null;
  }

  private _desktopFileExists(desktopId: string): boolean {
    return this._getApplicationDataDirs().some((dir) =>
      GLib.file_test(GLib.build_filenamev([dir, desktopId]), GLib.FileTest.EXISTS),
    );
  }

  private _getApplicationDataDirs(): string[] {
    return [
      GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']),
      GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local/share/flatpak/exports/share/applications',
      ]),
      ...GLib.get_system_data_dirs().map((dir) => GLib.build_filenamev([dir, 'applications'])),
      '/var/lib/flatpak/exports/share/applications',
    ];
  }

  private _isMenuIconKey(value: string): value is MenuIconKey {
    return value in MENU_ICONS;
  }

  private _parseCommandLine(raw: string, key: string): string[] {
    try {
      const [ok, argv] = GLib.shell_parse_argv(raw);
      if (ok && argv && argv.length > 0) return argv;
    } catch (e) {
      logger.warn(`Invalid command in ${key}: ${e}`, { prefix: LOG_PREFIX });
    }

    return [];
  }
}
