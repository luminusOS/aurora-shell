// @ts-nocheck
import { gettext as _ } from 'gettext';
import Meta from '@girs/meta-17';
import St from '@girs/st-17';
import Clutter from '@girs/clutter-17';
import * as AltTab from '@girs/gnome-shell/ui/altTab';

import type { ExtensionContext } from '~/core/context.ts';
import { loadIcon } from '~/shared/icons.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/moduleDefinition.ts';

export class XwaylandIndicator extends Module {
  private _origAppPopupInit: ((...args: unknown[]) => void) | null = null;
  private _origWinPopupInit: ((...args: unknown[]) => void) | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._patchAppSwitcherPopup();
    this._patchWindowSwitcherPopup();
  }

  override disable(): void {
    if (this._origAppPopupInit) {
      AltTab.AppSwitcherPopup.prototype._init = this._origAppPopupInit;
      this._origAppPopupInit = null;
    }
    if (this._origWinPopupInit) {
      AltTab.WindowSwitcherPopup.prototype._init = this._origWinPopupInit;
      this._origWinPopupInit = null;
    }
  }

  private _patchAppSwitcherPopup(): void {
    const origInit = AltTab.AppSwitcherPopup.prototype._init;
    const decorate = this._decorateAppItems.bind(this);
    this._origAppPopupInit = origInit;

    AltTab.AppSwitcherPopup.prototype._init = function (...args: any[]) {
      origInit.call(this, ...args);
      decorate(this._switcherList);
    };
  }

  private _patchWindowSwitcherPopup(): void {
    const origInit = AltTab.WindowSwitcherPopup.prototype._init;
    const decorate = this._decorateWindowItems.bind(this);
    this._origWinPopupInit = origInit;

    AltTab.WindowSwitcherPopup.prototype._init = function (...args: any[]) {
      origInit.call(this, ...args);
      decorate(this._switcherList);
    };
  }

  private _decorateAppItems(list: any): void {
    const icons: any[] = list?.icons ?? list?._appIcons ?? [];
    const items: any[] = list?._items ?? [];

    icons.forEach((icon: any, i: number) => {
      const app = icon?.app;
      if (!app?.get_windows) return;

      const isX11 = app
        .get_windows()
        .some((w: any) => w.get_client_type?.() === Meta.WindowClientType.X11);

      if (isX11 && items[i]) {
        this._addBadge(items[i]);
      }
    });
  }

  private _decorateWindowItems(list: any): void {
    const windows: any[] = list?.windows ?? list?._windows ?? [];
    const items: any[] = list?._items ?? [];

    windows.forEach((win: any, i: number) => {
      try {
        if (win.get_client_type?.() === Meta.WindowClientType.X11 && items[i]) {
          this._addBadge(items[i]);
        }
      } catch {
        // Window may have been closed between listing and decorating
      }
    });
  }

  private _addBadge(item: Clutter.Actor): void {
    const iconActor = item?.get_first_child?.();
    if (!iconActor) return;

    const wrapper = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
    });

    item.replace_child(iconActor, wrapper);
    wrapper.add_child(iconActor);

    const badge = new St.Icon({
      gicon: loadIcon('window-x11-symbolic'),
      icon_size: 32,
      style_class: 'xwayland-indicator-badge',
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.START,
    });
    wrapper.add_child(badge);
  }
}

export const definition: ModuleDefinition = {
  key: 'xwayland-indicator',
  settingsKey: 'module-xwayland-indicator',
  title: _('XWayland Indicator'),
  subtitle: _('Shows an X11 badge on XWayland apps in the Alt+Tab switcher'),
  factory: (ctx) => new XwaylandIndicator(ctx),
};
