// @ts-nocheck
import '@girs/gjs';
import { gettext as _ } from 'gettext';

import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/moduleDefinition.ts';
import { BluetoothDeviceItemPatcher } from '~/modules/bluetoothMenu/deviceItem.ts';
import { IconThemeLoader } from '~/shared/icons.ts';

export class BluetoothMenu extends Module {
  private _toggle: any = null;
  private _patchers = new Map<any, BluetoothDeviceItemPatcher>();
  private _iconLoader: IconThemeLoader | null = null;
  private _actorAddedId = 0;
  private _gridChildAddedId = 0;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._iconLoader = new IconThemeLoader(null);
    const toggle = this._findBluetoothToggle();
    if (toggle) {
      this._attach(toggle);
      return;
    }

    const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
    if (!grid) {
      console.error('Aurora Shell: BluetoothMenu could not find quick settings grid');
      return;
    }

    this._gridChildAddedId = grid.connect('child-added', () => {
      if (this._toggle) return;
      const t = this._findBluetoothToggle();
      if (t) {
        grid.disconnect(this._gridChildAddedId);
        this._gridChildAddedId = 0;
        this._attach(t);
      }
    });
  }

  override disable(): void {
    if (this._gridChildAddedId) {
      Main.panel.statusArea.quickSettings?.menu?._grid?.disconnect(this._gridChildAddedId);
      this._gridChildAddedId = 0;
    }

    if (this._actorAddedId && this._toggle) {
      this._toggle._deviceSection?.actor?.disconnect(this._actorAddedId);
      this._actorAddedId = 0;
    }

    for (const patcher of this._patchers.values()) {
      patcher.restore();
    }
    this._patchers.clear();

    if (this._toggle) {
      this._toggle.menu?.actor?.remove_style_class_name('aurora-bt-menu');
      this._toggle = null;
    }

    this._iconLoader = null;
  }

  private _findBluetoothToggle(): any {
    const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
    if (!grid) return null;

    for (const child of grid.get_children()) {
      if (child.constructor.name === 'BluetoothToggle') return child;
    }
    return null;
  }

  private _attach(toggle: any): void {
    this._toggle = toggle;
    toggle.menu.actor.add_style_class_name('aurora-bt-menu');

    for (const item of toggle._deviceItems.values()) {
      this._patchItem(item);
    }

    this._actorAddedId = toggle._deviceSection.actor.connect(
      'child-added',
      (_container: any, child: any) => {
        if (child.constructor.name === 'BluetoothDeviceItem') {
          this._patchItem(child);
        }
      },
    );
  }

  private _patchItem(item: any): void {
    if (this._patchers.has(item) || item.__auroraBtPatched) return;
    item.__auroraBtPatched = true;
    const patcher = new BluetoothDeviceItemPatcher(item, this._iconLoader!);
    this._patchers.set(item, patcher);

    item.connect('destroy', () => {
      this._patchers.delete(item);
    });
  }
}

export const definition: ModuleDefinition = {
  key: 'bluetooth-menu',
  settingsKey: 'module-bluetooth-menu',
  title: _('Bluetooth Menu'),
  subtitle: _('Shows battery level and animated icons in the Bluetooth Quick Settings panel'),
  factory: (ctx) => new BluetoothMenu(ctx),
};
