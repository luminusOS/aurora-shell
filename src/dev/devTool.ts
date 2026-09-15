import '@girs/gjs';

import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import GLib from '@girs/glib-2.0';
import Atk from '@girs/atk-1.0';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PanelMenu from '@girs/gnome-shell/ui/panelMenu';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource, createManagedTimeout, type ManagedTimeout } from '~/core/mainLoop.ts';
import { Module } from '~/module.ts';
import { MODULE_CATALOG } from '~/moduleCatalog.ts';
import { gettext as _ } from '~/shared/i18n.ts';
import { createIcon } from '~/shared/icons.ts';

import { CalendarRemindersDevTool } from './calendarRemindersDevTool.ts';
import { CaptureToolsDevTool } from './captureToolsDevTool.ts';
import { ClipboardHistoryDevTool } from './clipboardHistoryDevTool.ts';
import { DevToolModuleBrowser, plainText } from './devToolModuleBrowser.ts';
import { DevToolModuleSettings } from './devToolModuleSettings.ts';
import { createDevToolGroup, createDevToolRow } from './devToolUi.ts';
import { DockDevTool } from './dockDevTool.ts';
import { GeneralDevTool } from './generalDevTool.ts';
import { TrayIconsDevTool } from './trayIconsDevTool.ts';
import { WeatherClockDevTool } from './weatherClockDevTool.ts';

const DEVTOOL_ID = 'aurora-devtool';

type DevToolSection = {
  key: string;
  title: string;
  iconName: string;
  buildPanel(): St.Widget;
};

type DevToolCallbacks = {
  getModule(key: string): Module | null;
  openPreferences(): void;
  versionName: string;
};

type DevTools = {
  general: GeneralDevTool;
  captureTools: CaptureToolsDevTool;
  dock: DockDevTool;
  clipboardHistory: ClipboardHistoryDevTool;
  trayIcons: TrayIconsDevTool;
  weatherClock: WeatherClockDevTool;
  calendarReminders: CalendarRemindersDevTool;
};

type Route =
  | { type: 'modules' }
  | { type: 'devtools' }
  | { type: 'module'; key: string }
  | { type: 'commands'; key: string; optionKey: string }
  | { type: 'devtool'; key: string };

const DEVTOOL_SECTION_SUBTITLES: Record<string, string> = {
  general: _('Extension tools and session info'),
  dock: _('Visibility, layout and monitor bindings'),
  'capture-tools': _('Annotation overlay and OCR states'),
  'clipboard-history': _('Populate the history panel'),
  'tray-icons': _('Fake SNI items and attention badges'),
  'weather-clock': _('Fake weather snapshots'),
  'calendar-reminders': _('Fake events and alerts'),
};

export class DevTool extends Module {
  private _button: PanelMenu.Button | null = null;
  private _menuOpenStateId = 0;
  private _tools: DevTools | null = null;
  private _routes: Route[] = [{ type: 'modules' }];
  private _toast = '';
  private _lastAnimatedRoute = '';
  private _returnFocusNames: string[] = [];
  private _scrollPositions = new Map<string, number>();
  private _lifecycle: LifecycleScope | null = null;
  private _toastTimer: ManagedTimeout | null = null;
  private _uiRestoreIdle: ManagedSource | null = null;
  private readonly _moduleBrowser: DevToolModuleBrowser;
  private readonly _moduleSettings: DevToolModuleSettings;

  constructor(
    context: ExtensionContext,
    private readonly _callbacks: DevToolCallbacks,
  ) {
    super(context);
    this._moduleBrowser = new DevToolModuleBrowser(context.settings, {
      openModule: (key, returnFocusName) =>
        this._navigate({ type: 'module', key }, returnFocusName),
    });
    this._moduleSettings = new DevToolModuleSettings(context.settings, {
      getModule: this._callbacks.getModule,
      rebuild: (requestedFocusName) => this._rebuildMenu(requestedFocusName),
      openCommands: (key, optionKey, returnFocusName) =>
        this._navigate({ type: 'commands', key, optionKey }, returnFocusName),
      openDeveloperTool: (key, returnFocusName) =>
        this._navigate({ type: 'devtool', key }, returnFocusName),
      hasDeveloperTool: (key) => this._section(key) !== undefined,
      buildHero: (title, subtitle) => this._buildHero(title, subtitle),
    });
  }

  override enable(): void {
    this.disable();

    this._button = new PanelMenu.Button(1.0, 'Aurora DevTool');
    this._button.add_child(
      createIcon('applications-engineering-symbolic', {
        icon_size: 16,
        style_class: 'system-status-icon',
      }),
    );

    this._lifecycle = new LifecycleScope();
    this._toastTimer = createManagedTimeout(this._lifecycle);
    this._uiRestoreIdle = createManagedSource(this._lifecycle);
    const rebuild = () => this._showToast(_('Runtime updated'));
    this._tools = {
      general: new GeneralDevTool(
        this._callbacks.openPreferences,
        () => {
          const menu = this._getMenu();
          if (menu) menu.close();
        },
        this._callbacks.versionName,
        () =>
          MODULE_CATALOG.filter((manifest) =>
            this.context.settings.getBoolean(manifest.settingsKey),
          ).length,
      ),
      captureTools: new CaptureToolsDevTool(this._callbacks.getModule, rebuild),
      dock: new DockDevTool(this.context.settings, this._callbacks.getModule, rebuild),
      clipboardHistory: new ClipboardHistoryDevTool(this._callbacks.getModule, rebuild),
      trayIcons: new TrayIconsDevTool(rebuild),
      weatherClock: new WeatherClockDevTool(this._callbacks.getModule, rebuild),
      calendarReminders: new CalendarRemindersDevTool(
        this.context.settings,
        this._callbacks.getModule,
        rebuild,
      ),
    };

    const menu = this._getMenu();
    if (!menu) return;

    menu.setSourceAlignment(1.0);
    menu.actor.add_style_class_name('aurora-devtool-menu');
    this._menuOpenStateId = menu.connect('open-state-changed', (_menu, open) => {
      if (open) {
        this._routes = [{ type: 'modules' }];
        this._moduleBrowser.resetQuery();
        this._moduleSettings.resetEditor();
        this._lastAnimatedRoute = '';
        this._returnFocusNames = [];
        this._scrollPositions.clear();
        this._rebuildMenu();
      }
      return undefined;
    });

    this._rebuildMenu();
    Main.panel.addToStatusArea(DEVTOOL_ID, this._button, 2, 'left');
  }

  override disable(): void {
    const tools = this._tools;
    this._tools = null;
    if (this._lifecycle) this._lifecycle.dispose();
    this._lifecycle = null;
    this._toastTimer = null;
    this._uiRestoreIdle = null;
    if (tools) {
      tools.captureTools.destroy();
      tools.trayIcons.destroy();
      tools.weatherClock.destroy();
      tools.calendarReminders.destroy();
    }
    this._toast = '';
    this._lastAnimatedRoute = '';
    this._returnFocusNames = [];
    this._scrollPositions.clear();
    this._moduleBrowser.resetQuery();
    this._moduleSettings.resetEditor();
    if (this._menuOpenStateId && this._button) {
      (this._button.menu as PopupMenu.PopupMenu).disconnect(this._menuOpenStateId);
      this._menuOpenStateId = 0;
    }
    if (this._button) this._button.destroy();
    this._button = null;
  }

  get trayIconsTool(): TrayIconsDevTool | null {
    return this._tools ? this._tools.trayIcons : null;
  }

  get clipboardHistoryTool(): ClipboardHistoryDevTool | null {
    return this._tools ? this._tools.clipboardHistory : null;
  }

  get captureToolsTool(): CaptureToolsDevTool | null {
    return this._tools ? this._tools.captureTools : null;
  }

  get generalTool(): GeneralDevTool | null {
    return this._tools ? this._tools.general : null;
  }

  get dockTool(): DockDevTool | null {
    return this._tools ? this._tools.dock : null;
  }

  get calendarRemindersTool(): CalendarRemindersDevTool | null {
    return this._tools ? this._tools.calendarReminders : null;
  }

  get weatherClockTool(): WeatherClockDevTool | null {
    return this._tools ? this._tools.weatherClock : null;
  }

  private _route(): Route {
    if (this._routes.length === 0) return { type: 'modules' };
    return this._routes.at(-1)!;
  }

  private _navigate(route: Route, returnFocusName: string): void {
    this._routes.push(route);
    this._returnFocusNames.push(returnFocusName);
    this._moduleSettings.resetEditor();
    this._rebuildMenu('aurora-devtool-focus-back');
  }

  private _back(): void {
    if (this._routes.length <= 1) return;

    this._routes.pop();
    const returnFocusName = this._returnFocusNames.pop();
    this._moduleSettings.resetEditor();
    this._rebuildMenu(returnFocusName);
  }

  private _rebuildMenu(requestedFocusName?: string): void {
    if (!this._button) return;

    const menu = this._button.menu as PopupMenu.PopupMenu;
    const currentScroll = this._findScrollView(menu.actor);
    if (currentScroll && this._lastAnimatedRoute)
      this._scrollPositions.set(this._lastAnimatedRoute, currentScroll.vadjustment.value);

    const focused = global.stage.get_key_focus();
    const focusName = requestedFocusName || (focused ? focused.name : '') || '';
    menu.removeAll();

    const route = this._route();
    const routeSignature = this._routeSignature(route);
    const animatePage = routeSignature !== this._lastAnimatedRoute;
    this._lastAnimatedRoute = routeSignature;

    const section = new PopupMenu.PopupMenuSection();
    section.box.add_child(this._buildCard(animatePage, this._button));
    menu.addMenuItem(section);

    const scrollPosition = this._scrollPositions.get(routeSignature) || 0;
    if (!focusName && scrollPosition === 0) return;

    if (!this._uiRestoreIdle) return;
    const uiRestoreIdle = this._uiRestoreIdle;
    uiRestoreIdle.replace(() =>
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        uiRestoreIdle.complete();
        if (!this._button) return GLib.SOURCE_REMOVE;

        const rebuiltMenu = this._button.menu as PopupMenu.PopupMenu;
        const scroll = this._findScrollView(rebuiltMenu.actor);
        if (scroll) scroll.vadjustment.value = scrollPosition;
        if (focusName) {
          const focusTarget = this._findNamedActor(rebuiltMenu.actor, focusName);
          if (focusTarget instanceof St.Widget && focusTarget.can_focus && focusTarget.visible)
            focusTarget.grab_key_focus();
        }
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _routeSignature(route: Route): string {
    if (route.type === 'module' || route.type === 'devtool') return `${route.type}:${route.key}`;
    if (route.type === 'commands') return `${route.type}:${route.key}:${route.optionKey}`;
    return route.type;
  }

  private _findNamedActor(actor: Clutter.Actor, name: string): Clutter.Actor | null {
    if (actor.name === name) return actor;
    for (const child of actor.get_children()) {
      const match = this._findNamedActor(child, name);
      if (match) return match;
    }
    return null;
  }

  private _findScrollView(actor: Clutter.Actor): St.ScrollView | null {
    if (actor instanceof St.ScrollView) return actor;
    for (const child of actor.get_children()) {
      const match = this._findScrollView(child);
      if (match) return match;
    }
    return null;
  }

  private _buildCard(animatePage: boolean, sourceActor: Clutter.Actor): St.Widget {
    const monitor = Main.layoutManager.findMonitorForActor(sourceActor);
    const monitorIndex = monitor ? monitor.index : Main.layoutManager.primaryIndex;
    const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
    const width = Math.min(448, Math.max(1, workArea.width - 24));
    const maxHeight = Math.max(1, workArea.height - 48);
    const panel = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-panel',
      style: `width: ${width}px; max-height: ${maxHeight}px;`,
      x_expand: true,
    });
    panel.add_child(this._buildHeader());

    const route = this._route();
    if (route.type === 'modules' || route.type === 'devtools')
      panel.add_child(this._buildViewSwitcher(route.type));
    const viewport = new St.Viewport({ layout_manager: new Clutter.BinLayout() });
    const page = this._buildRoute(route);
    viewport.add_child(page);
    if (route.type === 'modules') panel.add_child(this._moduleBrowser.buildSearch(viewport));

    if (animatePage) {
      page.opacity = 0;
      page.translation_x = 10;
      page.ease({
        opacity: 255,
        translationX: 0,
        duration: 180,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }

    const scroll = new St.ScrollView({
      style_class: 'aurora-devtool-scroll',
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      x_expand: true,
    });
    scroll.add_child(viewport);
    panel.add_child(scroll);

    const stack = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      x_expand: true,
      y_expand: true,
    });
    stack.add_child(panel);
    if (this._toast)
      stack.add_child(
        new St.Label({
          text: this._toast,
          style_class: 'aurora-devtool-toast',
          accessible_role: Atk.Role.NOTIFICATION,
          x_align: Clutter.ActorAlign.CENTER,
          y_align: Clutter.ActorAlign.END,
        }),
      );
    return stack;
  }

  private _showToast(message: string): void {
    if (!this._toastTimer || !this._button) return;

    this._toast = message;
    this._rebuildMenu();
    this._toastTimer.schedule(2600, () => {
      this._toast = '';
      this._rebuildMenu();
    });
  }

  private _buildHeader(): St.Widget {
    const route = this._route();
    const header = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      style_class: 'aurora-devtool-header',
      x_expand: true,
    });
    const canGoBack = this._routes.length > 1;

    const nav = new St.BoxLayout({ style_class: 'aurora-devtool-header-nav', x_expand: true });
    const back = new St.Button({
      child: new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 16 }),
      style_class: 'button aurora-devtool-header-button aurora-devtool-back-button',
      can_focus: canGoBack,
      reactive: canGoBack,
      visible: canGoBack,
      y_align: Clutter.ActorAlign.CENTER,
      accessible_name: _('Back'),
      name: 'aurora-devtool-focus-back',
    });
    back.connect('clicked', () => this._back());
    nav.add_child(back);
    nav.add_child(new St.Widget({ x_expand: true }));
    header.add_child(nav);

    const labels = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-header-labels',
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      reactive: false,
    });
    labels.add_child(
      new St.Label({ text: this._routeTitle(route), style_class: 'aurora-devtool-title' }),
    );
    labels.add_child(
      new St.Label({ text: this._routeSubtitle(route), style_class: 'aurora-devtool-subtitle' }),
    );
    header.add_child(labels);
    return header;
  }

  private _routeTitle(route: Route): string {
    if (route.type === 'module') {
      const manifest = MODULE_CATALOG.find((entry) => entry.key === route.key);
      return manifest ? plainText(manifest.title) : _('Module');
    }
    if (route.type === 'commands') return _('Custom Commands');
    return _('Aurora DevTool');
  }

  private _routeSubtitle(route: Route): string {
    if (route.type === 'modules') return _('Modules');
    if (route.type === 'devtools') return _('Developer Tools');
    if (route.type === 'module') return _('Module Settings');
    if (route.type === 'commands') return _('Aurora Menu');

    const section = this._section(route.key);
    return section ? section.title : _('Developer Tool');
  }

  private _buildViewSwitcher(active: 'modules' | 'devtools'): St.Widget {
    const switcher = new St.BoxLayout({ style_class: 'aurora-devtool-view-switcher' });
    const track = new St.BoxLayout({ style_class: 'aurora-devtool-view-track', x_expand: true });
    for (const [key, label, iconName] of [
      ['modules', _('Modules'), 'view-app-grid-symbolic'],
      ['devtools', _('Dev Tools'), 'applications-engineering-symbolic'],
    ] as const) {
      const content = new St.BoxLayout({
        style_class: 'aurora-devtool-view-button-content',
        x_align: Clutter.ActorAlign.CENTER,
      });
      content.add_child(new St.Icon({ icon_name: iconName, icon_size: 14 }));
      content.add_child(new St.Label({ text: label }));
      const button = new St.Button({
        child: content,
        style_class:
          key === active
            ? 'button aurora-devtool-view-button active'
            : 'button aurora-devtool-view-button',
        can_focus: true,
        x_expand: true,
        toggle_mode: true,
        checked: key === active,
        accessible_name: label,
        name: `aurora-devtool-focus-view-${key}`,
      });
      button.connect('clicked', () => {
        this._routes = [{ type: key }];
        this._returnFocusNames = [];
        this._moduleBrowser.resetQuery();
        this._moduleSettings.resetEditor();
        this._rebuildMenu(`aurora-devtool-focus-view-${key}`);
      });
      track.add_child(button);
    }
    switcher.add_child(track);
    return switcher;
  }

  private _buildRoute(route: Route): St.Widget {
    let page: St.Widget;
    if (route.type === 'modules') page = this._moduleBrowser.buildRoot();
    else if (route.type === 'devtools') page = this._buildDevTools();
    else if (route.type === 'module') page = this._moduleSettings.buildModule(route.key);
    else if (route.type === 'commands')
      page = this._moduleSettings.buildCommands(route.key, route.optionKey);
    else page = this._buildDevTool(route.key);
    page.x_expand = true;
    return page;
  }

  private _buildDevTools(): St.Widget {
    const content = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-content',
    });
    const group = createDevToolGroup(
      _('Developer Tools'),
      _('Simulate runtime states and trigger module actions'),
    );
    for (const section of this._sections()) {
      const focusName = `aurora-devtool-focus-devtool-${section.key}`;
      const button = new St.Button({
        child: createDevToolRow(
          section.title,
          DEVTOOL_SECTION_SUBTITLES[section.key] || _('Inspect and simulate runtime state'),
          new St.Icon({ icon_name: 'go-next-symbolic', icon_size: 16 }),
          section.iconName,
        ),
        style_class: 'button aurora-devtool-list-button',
        can_focus: true,
        x_expand: true,
        name: focusName,
      });
      button.connect('clicked', () =>
        this._navigate({ type: 'devtool', key: section.key }, focusName),
      );
      group.list.add_child(button);
    }
    content.add_child(group.container);
    return content;
  }

  private _buildDevTool(key: string): St.Widget {
    const section = this._section(key);
    const content = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-content',
    });
    if (!section) return content;

    content.add_child(this._buildHero(section.title, _('Live development controls')));
    content.add_child(section.buildPanel());
    return content;
  }

  private _buildHero(title: string, subtitle: string): St.Widget {
    const hero = new St.BoxLayout({ style_class: 'aurora-devtool-hero', x_expand: true });
    const labels = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'aurora-devtool-hero-labels',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    labels.add_child(new St.Label({ text: title, style_class: 'aurora-devtool-hero-title' }));
    const subtitleLabel = new St.Label({
      text: subtitle,
      style_class: 'aurora-devtool-hero-subtitle',
      x_expand: true,
    });
    subtitleLabel.clutter_text.line_wrap = true;
    labels.add_child(subtitleLabel);
    hero.add_child(labels);
    return hero;
  }

  private _section(key: string): DevToolSection | undefined {
    return this._sections().find((section) => section.key === key);
  }

  private _sections(): DevToolSection[] {
    return this._tools ? Object.values(this._tools) : [];
  }

  private _getMenu(): PopupMenu.PopupMenu | null {
    return this._button ? (this._button.menu as PopupMenu.PopupMenu) : null;
  }
}
