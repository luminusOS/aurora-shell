import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import { attachToQuickSettings, getQuickSettingsGrid } from '~/shared/quickSettings.ts';
import { BluetoothDeviceItemPatcher } from '~/panel/bluetoothMenu/deviceItem.ts';

const LOG_PREFIX = 'BluetoothMenu';

type PatchedItem = {
  patcher: BluetoothDeviceItemPatcher;
  destroyId: number;
};

export class BluetoothMenu extends Module {
  private _patchedItems = new Map<any, PatchedItem>();
  private _lifecycle: LifecycleScope | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._lifecycle = new LifecycleScope();
    const detachQuickSettings = attachToQuickSettings(
      () => this._findBluetoothToggle(),
      (toggle) => this._attach(toggle),
    );
    if (!detachQuickSettings) {
      logger.error('Could not find quick settings grid', { prefix: LOG_PREFIX });
    } else {
      this._lifecycle.onDispose(detachQuickSettings);
    }
  }

  override disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;

    for (const [item, { patcher, destroyId }] of this._patchedItems) {
      item.disconnect(destroyId);
      patcher.disable();
    }
    this._patchedItems.clear();
  }

  private _findBluetoothToggle(): any {
    const grid = getQuickSettingsGrid();
    if (!grid) return null;

    for (const child of grid.get_children()) {
      if (child.constructor.name === 'BluetoothToggle') return child;
    }
    return null;
  }

  private _attach(toggle: any): void {
    if (!this._lifecycle) return;

    toggle.menu.actor.add_style_class_name('aurora-bt-menu');
    this._lifecycle.onDispose(() => toggle.menu.actor.remove_style_class_name('aurora-bt-menu'));

    for (const item of toggle._deviceItems.values()) {
      this._patchItem(item);
    }

    const actorAddedId = toggle._deviceSection.actor.connect(
      'child-added',
      (_container: any, child: any) => {
        if (child.constructor.name === 'BluetoothDeviceItem') {
          this._patchItem(child);
        }
      },
    );
    this._lifecycle.onDispose(() => toggle._deviceSection.actor.disconnect(actorAddedId));
  }

  private _patchItem(item: any): void {
    if (this._patchedItems.has(item) || item.__auroraBtPatched) return;
    item.__auroraBtPatched = true;
    const patcher = new BluetoothDeviceItemPatcher(item);
    patcher.enable();

    const destroyId = item.connect('destroy', () => {
      patcher.disable({ restoreOriginalChildren: false });
      this._patchedItems.delete(item);
    });
    this._patchedItems.set(item, { patcher, destroyId });
  }
}
