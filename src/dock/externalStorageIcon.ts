import { gettext as _ } from '~/shared/i18n.ts';

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as IconGrid from 'resource:///org/gnome/shell/ui/iconGrid.js';
import { DashItemContainer } from 'resource:///org/gnome/shell/ui/dash.js';

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

      this.toggleButton.connectObject('clicked', () => this._operations.open(), this);
      const menuGesture = new Clutter.ClickGesture({
        recognize_on_press: true,
        required_button: Clutter.BUTTON_SECONDARY,
      });
      menuGesture.connect('recognize', () => this._menu?.toggle());
      this.toggleButton.add_action(menuGesture);
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
  return new ExternalStorageIcon(item);
}
