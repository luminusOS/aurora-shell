import '@girs/gjs';

import AccountsService from '@girs/accountsservice-1.0';
import GLib from '@girs/glib-2.0';
import type St from '@girs/st-18';
import { UserWidget } from '@girs/gnome-shell/ui/userWidget';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import { attachToQuickSettings, getQuickSettingsGrid } from '~/shared/quickSettings.ts';

const LOG_PREFIX = 'PowerMenuAvatar';
const AVATAR_INSERT_INDEX = 1;

type PowerMenu = {
  box: St.BoxLayout;
  _header: St.Widget;
};

type SystemItem = {
  menu: PowerMenu;
};

const UserWidgetWithUser = UserWidget as typeof UserWidget & {
  new (user: AccountsService.User): UserWidget;
};

function createUserWidget(user: AccountsService.User): UserWidget {
  return new UserWidgetWithUser(user);
}

export class PowerMenuAvatar extends Module {
  private _lifecycle: LifecycleScope | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._lifecycle = new LifecycleScope();

    const detachQuickSettings = attachToQuickSettings(
      () => this._findSystemItem(),
      (systemItem) => this._attach(systemItem),
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
  }

  private _findSystemItem(): SystemItem | null {
    const grid = getQuickSettingsGrid();
    if (!grid) return null;

    const systemItem = grid
      .get_children()
      .find((child: any) => child.constructor.name === 'SystemItem');
    if (!systemItem) return null;

    return systemItem;
  }

  private _attach(systemItem: SystemItem): void {
    if (!this._lifecycle) return;

    const userManager = AccountsService.UserManager.get_default();
    const user = userManager.get_user(GLib.get_user_name());
    const avatar = createUserWidget(user);
    avatar.add_style_class_name('aurora-power-menu-avatar');

    systemItem.menu._header.hide();
    this._lifecycle.onDispose(() => systemItem.menu._header.show());

    systemItem.menu.box.insert_child_at_index(avatar, AVATAR_INSERT_INDEX);
    this._lifecycle.onDispose(() => avatar.destroy());
  }
}
