import { gettext as _ } from '~/shared/i18n.ts';
import Meta from '@girs/meta-18';
import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import * as AltTab from '@girs/gnome-shell/ui/altTab';

import type { ExtensionContext } from '~/core/context.ts';
import { createIcon } from '~/shared/icons.ts';
import { Module } from '~/module.ts';

type SwitcherPatch = {
  prototype: any;
  original: (...args: any[]) => void;
  wrapper: (...args: any[]) => void;
};

export class XwaylandIndicator extends Module {
  private _patches: SwitcherPatch[] = [];

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._installPatch(AltTab.AppSwitcherPopup.prototype, (list) => this._decorateAppItems(list));
    this._installPatch(AltTab.WindowSwitcherPopup.prototype, (list) =>
      this._decorateWindowItems(list),
    );
  }

  override disable(): void {
    for (const patch of [...this._patches].reverse()) {
      if (patch.prototype._init === patch.wrapper) {
        patch.prototype._init = patch.original;
      }
    }

    this._patches = [];
  }

  private _installPatch(prototype: any, decorate: (list: any) => void): void {
    const original = prototype._init;
    const wrapper = function (this: any, ...args: any[]) {
      original.apply(this, args);
      decorate((this as any)._switcherList);
    };

    prototype._init = wrapper;
    this._patches.push({ prototype, original, wrapper });
  }

  private _decorateAppItems(list: any): void {
    const icons: any[] = list.icons;
    const items: any[] = list._items;

    icons.forEach((icon: any, i: number) => {
      const app = icon.app;

      const isX11 = app
        .get_windows()
        .some((window: Meta.Window) => window.get_client_type() === Meta.WindowClientType.X11);

      if (isX11 && items[i]) {
        this._addBadge(items[i]);
      }
    });
  }

  private _decorateWindowItems(list: any): void {
    const windows: any[] = list.windows;
    const items: any[] = list._items;

    windows.forEach((window: Meta.Window, index: number) => {
      if (window.get_client_type() === Meta.WindowClientType.X11 && items[index]) {
        this._addBadge(items[index]);
      }
    });
  }

  private _addBadge(item: Clutter.Actor): void {
    const iconActor = item.get_first_child();
    if (!iconActor) return;

    const wrapper = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
    });

    item.replace_child(iconActor, wrapper);
    wrapper.add_child(iconActor);

    const badge = createIcon('window-x11-symbolic', {
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
