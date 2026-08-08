import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';
import * as IconGrid from '@girs/gnome-shell/ui/iconGrid';
import { DashItemContainer } from '@girs/gnome-shell/ui/dash';

import type { ExternalStorageItem } from '~/dock/externalStorageMonitor.ts';
import { ExternalStorageOperations } from '~/dock/externalStorageOperations.ts';
export { ExternalStorageMonitor } from '~/dock/externalStorageMonitor.ts';
export type { ExternalStorageItem } from '~/dock/externalStorageMonitor.ts';

type SizableBaseIcon = InstanceType<typeof IconGrid.BaseIcon> & {
  setIconSize(size: number): void;
  y_align: Clutter.ActorAlign;
};

export const ExternalStorageIcon = GObject.registerClass(
  class ExternalStorageIcon extends DashItemContainer {
    declare toggleButton: St.Button;
    declare icon: SizableBaseIcon;
    declare private _iconActor: St.Icon | null;
    declare private _item: ExternalStorageItem;
    declare private _menu: PopupMenu.PopupMenu | null;
    declare private _menuManager: PopupMenu.PopupMenuManager | null;
    declare private _openItem: PopupMenu.PopupMenuItem | null;
    declare private _ejectItem: PopupMenu.PopupMenuItem | null;
    declare private _operations: ExternalStorageOperations;

    override _init(item?: ExternalStorageItem): void {
      super._init();

      if (!item) throw new Error('ExternalStorageIcon requires an item');

      this._iconActor = null;
      this._item = item;
      this._menu = null;
      this._menuManager = null;
      this._openItem = null;
      this._ejectItem = null;
      this._operations = new ExternalStorageOperations(item, () => this._syncMenuSensitivity());

      this.toggleButton = new St.Button({
        style_class: 'show-apps',
        track_hover: true,
        can_focus: true,
        reactive: true,
      });

      this.icon = new IconGrid.BaseIcon(item.name, {
        setSizeManually: true,
        showLabel: false,
        createIcon: (size: number) => this._createIcon(size),
      }) as SizableBaseIcon;
      this.icon.y_align = Clutter.ActorAlign.CENTER;

      this.toggleButton.child = this.icon;
      (this.toggleButton as St.Button & { _delegate?: unknown })._delegate = this;
      (this as { _delegate?: unknown })._delegate = this;

      this.setChild(this.toggleButton);
      this.setLabelText(item.name);

      this._buildMenu();

      this.toggleButton.connectObject(
        'clicked',
        () => this._operations.open(),
        'button-press-event',
        (_actor: St.Button, event: Clutter.Event) => {
          if (event.get_button() === Clutter.BUTTON_SECONDARY) {
            this._menu?.toggle();
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_PROPAGATE;
        },
        this,
      );
    }

    setIconSize(size: number): void {
      this.icon.setIconSize(size);
    }

    override destroy(): void {
      this._operations.destroy();
      this.toggleButton.disconnectObject(this);
      this._menu?.destroy();
      this._menu = null;
      this._menuManager = null;
      this._openItem = null;
      this._ejectItem = null;
      this._iconActor = null;
      super.destroy();
    }

    get menuIsOpen(): boolean {
      if (!this._menu) return false;

      return this._menu.isOpen;
    }

    private _createIcon(size: number): St.Icon {
      this._iconActor = new St.Icon({
        gicon: this._item.icon,
        icon_size: size,
        style_class: 'show-apps-icon',
        track_hover: true,
      });
      return this._iconActor;
    }

    private _buildMenu(): void {
      this._menu = new PopupMenu.PopupMenu(this.toggleButton, 0.5, St.Side.TOP);
      this._menu.actor.add_style_class_name('app-menu');
      Main.uiGroup.add_child(this._menu.actor);
      this._menu.actor.hide();

      this._menuManager = new PopupMenu.PopupMenuManager(this.toggleButton);
      this._menuManager.addMenu(this._menu);

      this._openItem = new PopupMenu.PopupMenuItem(
        this._item.mount ? _('Open') : _('Mount and Open'),
      );
      this._openItem.connectObject('activate', () => this._operations.open(), this);
      this._menu.addMenuItem(this._openItem);

      const ejectLabel = this._operations.canEject ? _('Eject') : _('Unmount');
      this._ejectItem = new PopupMenu.PopupMenuItem(ejectLabel);
      this._ejectItem.connectObject('activate', () => this._operations.eject(), this);
      this._menu.addMenuItem(this._ejectItem);

      this._syncMenuSensitivity();
    }

    private _syncMenuSensitivity(): void {
      this._openItem?.setSensitive(!this._operations.busy);
      this._ejectItem?.setSensitive(!this._operations.busy && this._operations.canUnmountOrEject);
    }
  },
);

export type ExternalStorageIconInstance = InstanceType<typeof ExternalStorageIcon>;

export function createExternalStorageIcon(item: ExternalStorageItem): ExternalStorageIconInstance {
  return new (ExternalStorageIcon as unknown as new (
    storageItem: ExternalStorageItem,
  ) => ExternalStorageIconInstance)(item);
}
