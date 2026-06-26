import '@girs/gjs';

import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import * as Main from '@girs/gnome-shell/ui/main';
import type { Button as PanelMenuButton } from '@girs/gnome-shell/ui/panelMenu';
import * as PanelMenu from '@girs/gnome-shell/ui/panelMenu';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import { loadIcon } from '~/shared/icons.ts';

import { ClipboardHistoryDevTool } from './clipboardHistoryDevTool.ts';
import { DockDevTool } from './dockDevTool.ts';
import { GeneralDevTool } from './generalDevTool.ts';
import { MeetingClockDevTool } from './meetingClockDevTool.ts';
import { TrayIconsDevTool } from './trayIconsDevTool.ts';
import { WeatherClockDevTool } from './weatherClockDevTool.ts';

const DEVTOOL_ID = 'aurora-devtool';

type DevToolSection = {
  key: string;
  title: string;
  iconName: string;
  buildPanel(): St.Widget;
  destroy(): void;
};

type DevToolCallbacks = {
  getModule(key: string): Module | null;
  openPreferences(): void;
};

export class DevTool extends Module {
  private _button: PanelMenu.Button | null = null;
  private _menuOpenStateId = 0;
  private _generalTool: GeneralDevTool | null = null;
  private _dockTool: DockDevTool | null = null;
  private _clipboardHistoryTool: ClipboardHistoryDevTool | null = null;
  private _trayIconsTool: TrayIconsDevTool | null = null;
  private _weatherClockTool: WeatherClockDevTool | null = null;
  private _meetingClockTool: MeetingClockDevTool | null = null;
  private _sections: DevToolSection[] = [];
  private _activeSectionKey = 'general';
  private _sectionDropdownOpen = false;

  constructor(
    context: ExtensionContext,
    private readonly _callbacks: DevToolCallbacks,
  ) {
    super(context);
  }

  override enable(): void {
    this._button = new PanelMenu.Button(1.0, 'Aurora DevTool');
    this._button.add_child(
      new St.Icon({
        gicon: loadIcon('applications-engineering-symbolic'),
        icon_size: 16,
        style_class: 'system-status-icon',
      }),
    );

    this._generalTool = new GeneralDevTool(() => this._callbacks.openPreferences());
    this._dockTool = new DockDevTool(
      (key) => this._callbacks.getModule(key),
      () => this._rebuildMenu(),
    );
    this._clipboardHistoryTool = new ClipboardHistoryDevTool(
      (key) => this._callbacks.getModule(key),
      () => this._rebuildMenu(),
    );
    this._trayIconsTool = new TrayIconsDevTool(() => this._rebuildMenu());
    this._weatherClockTool = new WeatherClockDevTool(
      (key) => this._callbacks.getModule(key),
      () => this._rebuildMenu(),
    );
    this._meetingClockTool = new MeetingClockDevTool(
      (key) => this._callbacks.getModule(key),
      () => this._rebuildMenu(),
    );
    this._sections = [
      this._generalTool,
      this._dockTool,
      this._clipboardHistoryTool,
      this._trayIconsTool,
      this._weatherClockTool,
      this._meetingClockTool,
    ];

    const menu = this._getMenu();
    if (!menu) return;
    menu.setSourceAlignment(1.0);

    this._menuOpenStateId = menu.connect('open-state-changed', (_menu, open) => {
      if (open) this._rebuildMenu();
      return undefined;
    });

    this._rebuildMenu();
    Main.panel.addToStatusArea(DEVTOOL_ID, this._button as unknown as PanelMenuButton, 2, 'left');
  }

  override disable(): void {
    for (const section of this._sections) {
      section.destroy();
    }
    this._sections = [];
    this._generalTool = null;
    this._dockTool = null;
    this._clipboardHistoryTool = null;
    this._trayIconsTool = null;
    this._weatherClockTool = null;
    this._meetingClockTool = null;

    if (this._menuOpenStateId && this._button) {
      this._getMenu()?.disconnect(this._menuOpenStateId);
      this._menuOpenStateId = 0;
    }

    (Main.panel.statusArea as Record<string, unknown>)[DEVTOOL_ID] = null;
    this._button?.destroy();
    this._button = null;
  }

  get trayIconsTool(): TrayIconsDevTool | null {
    return this._trayIconsTool;
  }

  get clipboardHistoryTool(): ClipboardHistoryDevTool | null {
    return this._clipboardHistoryTool;
  }

  get generalTool(): GeneralDevTool | null {
    return this._generalTool;
  }

  get dockTool(): DockDevTool | null {
    return this._dockTool;
  }

  get meetingClockTool(): MeetingClockDevTool | null {
    return this._meetingClockTool;
  }

  get weatherClockTool(): WeatherClockDevTool | null {
    return this._weatherClockTool;
  }

  private _rebuildMenu(): void {
    const menu = this._getMenu();
    if (!menu) return;

    menu.removeAll();
    const section = new PopupMenu.PopupMenuSection();
    section.box.add_child(this._buildPanel());
    menu.addMenuItem(section);
  }

  private _buildPanel(): St.Widget {
    const panel = new St.BoxLayout({
      vertical: true,
      style_class: 'aurora-devtool-panel',
    });

    panel.add_child(this._buildHeader());
    panel.add_child(this._buildBody());

    return panel;
  }

  private _buildHeader(): St.Widget {
    const header = new St.BoxLayout({
      style_class: 'aurora-devtool-header',
    });

    header.add_child(
      new St.Icon({
        gicon: loadIcon('applications-engineering-symbolic'),
        icon_size: 18,
        style_class: 'aurora-devtool-header-icon',
      }),
    );
    header.add_child(
      new St.Label({
        text: 'Aurora DevTool',
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'aurora-devtool-title',
      }),
    );

    return header;
  }

  private _buildBody(): St.Widget {
    const body = new St.BoxLayout({
      vertical: true,
      style_class: 'aurora-devtool-body',
      x_expand: true,
      y_expand: true,
    });

    body.add_child(this._buildSectionDropdown());

    const content = new St.BoxLayout({
      vertical: true,
      style_class: 'aurora-devtool-content',
      x_expand: true,
      y_expand: true,
    });

    const activeSection = this._activeSection();
    if (activeSection) {
      content.add_child(activeSection.buildPanel());
    }

    body.add_child(content);
    return body;
  }

  private _buildSectionDropdown(): St.Widget {
    const dropdown = new St.BoxLayout({
      vertical: true,
      style_class: 'aurora-devtool-section-dropdown',
      x_expand: true,
    });

    const activeSection = this._activeSection();
    if (activeSection) {
      dropdown.add_child(this._buildSectionTrigger(activeSection));
    }

    if (this._sectionDropdownOpen) {
      const list = new St.BoxLayout({
        vertical: true,
        style_class: 'aurora-devtool-section-menu',
        x_expand: true,
      });
      for (const section of this._sections) {
        list.add_child(this._buildSectionOption(section));
      }
      dropdown.add_child(list);
    }

    return dropdown;
  }

  private _buildSectionTrigger(section: DevToolSection): St.Button {
    const content = this._buildSectionButtonContent(section, 'pan-down-symbolic');
    const button = new St.Button({
      child: content,
      style_class: this._sectionDropdownOpen
        ? 'button aurora-devtool-section-trigger active'
        : 'button aurora-devtool-section-trigger',
      can_focus: true,
      x_expand: true,
      accessible_name: section.title,
    });
    button.connect('clicked', () => {
      this._sectionDropdownOpen = !this._sectionDropdownOpen;
      this._rebuildMenu();
    });
    return button;
  }

  private _buildSectionOption(section: DevToolSection): St.Button {
    const active = section.key === this._activeSectionKey;
    const content = this._buildSectionButtonContent(
      section,
      active ? 'object-select-symbolic' : null,
    );
    const button = new St.Button({
      child: content,
      style_class: active
        ? 'button aurora-devtool-section-option active'
        : 'button aurora-devtool-section-option',
      can_focus: true,
      x_expand: true,
      accessible_name: section.title,
    });
    button.connect('clicked', () => {
      this._activeSectionKey = section.key;
      this._sectionDropdownOpen = false;
      this._rebuildMenu();
    });
    return button;
  }

  private _buildSectionButtonContent(
    section: DevToolSection,
    suffixIconName: string | null,
  ): St.Widget {
    const content = new St.BoxLayout({
      style_class: 'aurora-devtool-section-button-content',
      x_expand: true,
    });

    content.add_child(
      new St.Icon({
        icon_name: section.iconName,
        icon_size: 16,
        style_class: 'aurora-devtool-section-icon',
      }),
    );
    content.add_child(
      new St.Label({
        text: section.title,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      }),
    );
    if (suffixIconName) {
      content.add_child(
        new St.Icon({
          icon_name: suffixIconName,
          icon_size: 16,
          style_class: 'aurora-devtool-section-suffix-icon',
        }),
      );
    }

    return content;
  }

  private _activeSection(): DevToolSection | null {
    return this._sections.find((section) => section.key === this._activeSectionKey) ?? null;
  }

  private _getMenu(): PopupMenu.PopupMenu | null {
    return (this._button?.menu as PopupMenu.PopupMenu | null | undefined) ?? null;
  }
}
