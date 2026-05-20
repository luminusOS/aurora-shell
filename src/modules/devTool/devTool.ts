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

import { TrayIconsDevTool } from './trayIconsDevTool.ts';

const DEVTOOL_ID = 'aurora-devtool';

type DevToolSection = {
  key: string;
  title: string;
  iconName: string;
  buildPanel(): St.Widget;
  destroy(): void;
};

export class DevTool extends Module {
  private _button: PanelMenu.Button | null = null;
  private _menuOpenStateId = 0;
  private _trayIconsTool: TrayIconsDevTool | null = null;
  private _sections: DevToolSection[] = [];
  private _activeSectionKey = 'tray-icons';

  constructor(context: ExtensionContext) {
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

    this._trayIconsTool = new TrayIconsDevTool(() => this._rebuildMenu());
    this._sections = [this._trayIconsTool];

    const menu = this._getMenu();
    if (!menu) return;
    menu.setSourceAlignment(1.0);

    this._menuOpenStateId = menu.connect('open-state-changed', (_menu, open) => {
      if (open) this._rebuildMenu();
      return undefined;
    });

    this._rebuildMenu();
    Main.panel.addToStatusArea(DEVTOOL_ID, this._button as unknown as PanelMenuButton, 1, 'left');
  }

  override disable(): void {
    for (const section of this._sections) {
      section.destroy();
    }
    this._sections = [];
    this._trayIconsTool = null;

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
    panel.add_child(this._buildTabs());

    const activeSection = this._activeSection();
    if (activeSection) {
      panel.add_child(activeSection.buildPanel());
    }

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

  private _buildTabs(): St.Widget {
    const tabs = new St.BoxLayout({
      style_class: 'aurora-devtool-tabs',
    });

    for (const section of this._sections) {
      const active = section.key === this._activeSectionKey;
      const tabContent = new St.BoxLayout({
        style_class: 'aurora-devtool-tab-content',
      });
      const tab = new St.Button({
        child: tabContent,
        style_class: active ? 'aurora-devtool-tab active' : 'aurora-devtool-tab',
        can_focus: true,
        x_expand: true,
        accessible_name: section.title,
      });

      tabContent.add_child(
        new St.Icon({
          icon_name: section.iconName,
          icon_size: 16,
          style_class: 'aurora-devtool-tab-icon',
        }),
      );
      tabContent.add_child(
        new St.Label({
          text: section.title,
          y_align: Clutter.ActorAlign.CENTER,
        }),
      );
      tab.connect('clicked', () => {
        this._activeSectionKey = section.key;
        this._rebuildMenu();
      });
      tabs.add_child(tab);
    }

    return tabs;
  }

  private _activeSection(): DevToolSection | null {
    return this._sections.find((section) => section.key === this._activeSectionKey) ?? null;
  }

  private _getMenu(): PopupMenu.PopupMenu | null {
    return (this._button?.menu as PopupMenu.PopupMenu | null | undefined) ?? null;
  }
}
