import '@girs/gjs';
import { gettext as _ } from 'gettext';

import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';
import { attachToQuickSettings } from '~/shared/quickSettings.ts';
import { BluetoothDeviceItemPatcher } from '~/modules/bluetoothMenu/deviceItem.ts';

const LOG_PREFIX = 'BluetoothMenu';

export class BluetoothMenu extends Module {
  private _toggle: any = null;
  private _patchers = new Map<any, BluetoothDeviceItemPatcher>();
  private _destroyIds = new Map<any, number>();
  private _actorAddedId = 0;
  private _detachQuickSettings: (() => void) | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._detachQuickSettings = attachToQuickSettings(
      () => this._findBluetoothToggle(),
      (toggle) => this._attach(toggle),
    );
    if (!this._detachQuickSettings) {
      logger.error('Could not find quick settings grid', { prefix: LOG_PREFIX });
    }
  }

  override disable(): void {
    this._detachQuickSettings?.();
    this._detachQuickSettings = null;

    if (this._actorAddedId && this._toggle) {
      this._toggle._deviceSection?.actor?.disconnect(this._actorAddedId);
      this._actorAddedId = 0;
    }

    for (const [item, id] of this._destroyIds) {
      item?.disconnect?.(id);
    }
    this._destroyIds.clear();

    for (const patcher of this._patchers.values()) {
      patcher.disable();
    }
    this._patchers.clear();

    if (this._toggle) {
      this._toggle.menu?.actor?.remove_style_class_name('aurora-bt-menu');
      this._toggle = null;
    }
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
    const patcher = new BluetoothDeviceItemPatcher(item);
    patcher.enable();
    this._patchers.set(item, patcher);

    const id = item.connect('destroy', () => {
      patcher.disable({ restoreOriginalChildren: false });
      this._patchers.delete(item);
      this._destroyIds.delete(item);
    });
    this._destroyIds.set(item, id);
  }
}

export const definition: ModuleDefinition = {
  key: 'bluetooth-menu',
  settingsKey: 'module-bluetooth-menu',
  section: 'dock-panel',
  title: _('Bluetooth Menu'),
  subtitle: _('Shows battery level and animated icons in the Bluetooth Quick Settings panel'),
  factory: (ctx) => new BluetoothMenu(ctx),
};
