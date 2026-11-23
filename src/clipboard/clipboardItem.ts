import { gettext as _ } from '~/shared/i18n.ts';

import GLib from 'gi://GLib';
import St from 'gi://St';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { thumbnailPathFor, type ClipboardEntry } from '~/clipboard/clipboardStore.ts';
import { classifyClipboardCard, parseClipboardUrl } from '~/clipboard/clipboardCardState.ts';
import {
  buildCodeCard,
  buildImageCard,
  buildLinkCard,
  buildTextCard,
} from '~/clipboard/clipboardCardBuilders.ts';

export type ClipboardItemCallbacks = {
  onActivate: (entry: ClipboardEntry) => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  scheduleMenuAction: (action: () => void) => void;
};

type ClipboardItemMenu = {
  popup: PopupMenu.PopupMenu;
  manager: PopupMenu.PopupMenuManager;
  host: Clutter.Actor;
};

export const ClipboardItem = GObject.registerClass(
  class ClipboardItem extends St.Button {
    declare private _entry: ClipboardEntry;
    declare private _callbacks: ClipboardItemCallbacks;
    declare private _actions: St.BoxLayout;
    declare private _pinButton: St.Button;
    declare private _removeButton: St.Button;
    declare private _menuButton: St.Button;
    declare private _menu: ClipboardItemMenu | null;

    override _init(entry: ClipboardEntry, callbacks: ClipboardItemCallbacks): void {
      super._init({
        style_class: 'aurora-clipboard-item',
        can_focus: true,
        x_expand: true,
        // Pin vertical expansion off explicitly. Otherwise Clutter computes
        // "needs expand" from descendants, and cards whose inner overlay sets
        // y_expand (image, code) would propagate it up and stretch the card to
        // fill the whole list. Inner overlays still expand within the card.
        y_expand: false,
        reactive: true,
        track_hover: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
      });

      this._entry = entry;
      this._callbacks = callbacks;
      this._menu = null;

      this._actions = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.START,
        style_class: 'aurora-clipboard-item-actions',
      });

      this._pinButton = this._createActionButton(
        'view-pin-symbolic',
        entry.pinned ? 'aurora-clipboard-item-action checked' : 'aurora-clipboard-item-action',
        () => this._callbacks.onTogglePin(this._entry.id),
      );
      this._actions.add_child(this._pinButton);

      this._removeButton = this._createActionButton(
        'user-trash-symbolic',
        'aurora-clipboard-item-action',
        () => this._callbacks.onRemove(this._entry.id),
      );
      this._actions.add_child(this._removeButton);

      this._menuButton = this._createActionButton(
        'view-more-symbolic',
        'aurora-clipboard-item-action menu',
        () => this._openMenu(),
      );
      this._actions.add_child(this._menuButton);
      this.setActionsVisible(false);

      this._buildCard();
    }

    get entry(): ClipboardEntry {
      return this._entry;
    }

    override destroy(): void {
      this._destroyMenu();
      super.destroy();
    }

    setActionsVisible(visible: boolean): void {
      const showPinnedBadge = !visible && this._entry.pinned;
      this._actions.visible = visible || showPinnedBadge;
      if (showPinnedBadge) {
        this._actions.add_style_class_name('pinned-badge');
      } else {
        this._actions.remove_style_class_name('pinned-badge');
      }

      this._pinButton.visible = visible || this._entry.pinned;
      this._pinButton.reactive = visible;
      this._pinButton.can_focus = visible;

      for (const button of [this._removeButton, this._menuButton]) {
        button.visible = visible;
        button.reactive = visible;
        button.can_focus = visible;
      }
    }

    private _buildCard(): void {
      const cardKind = classifyClipboardCard(this._entry.kind, this._entry.text);

      if (cardKind === 'image') {
        this._buildImageCard();
        return;
      }

      if (cardKind === 'link') {
        this._buildLinkCard();
        return;
      }

      const card =
        cardKind === 'code'
          ? buildCodeCard(this._entry, this._actions)
          : buildTextCard(this._entry, this._actions);
      this.set_child(card);
    }

    private _buildImageCard(): void {
      this.add_style_class_name('aurora-clipboard-item--image');

      const thumbnail = this._entry.filePath ? thumbnailPathFor(this._entry.filePath) : null;
      if (thumbnail && GLib.file_test(thumbnail, GLib.FileTest.EXISTS)) {
        this.style = `background-image: url("file://${thumbnail}"); background-size: cover;`;
      }

      this.set_child(buildImageCard(this._entry, this._actions));
    }

    private _buildLinkCard(): void {
      const url = this._entry.text.trim();
      const parsed = parseClipboardUrl(url);
      if (!parsed) return;

      this.add_style_class_name('aurora-clipboard-item--link');
      this.set_child(buildLinkCard(parsed, this._actions, this._entry.preview));
    }

    private _createActionButton(
      iconName: string,
      styleClass: string,
      action: () => void,
    ): St.Button {
      const button = new St.Button({
        style_class: styleClass,
        reactive: true,
        can_focus: true,
        track_hover: true,
        child: new St.Icon({
          icon_name: iconName,
          icon_size: 14,
        }),
      });
      button.connect('clicked', () => action());
      return button;
    }

    private _openMenu(): void {
      if (!this._menu) this._menu = this._createMenu();

      Main.uiGroup.set_child_above_sibling(this._menu.host, null);
      this._menu.popup.toggle();
    }

    private _createMenu(): ClipboardItemMenu {
      const popup = new PopupMenu.PopupMenu(this._menuButton, 0.5, St.Side.TOP);
      popup.actor.add_style_class_name('aurora-clipboard-item-menu');

      const { onActivate, onTogglePin, onRemove, scheduleMenuAction } = this._callbacks;
      const entry = this._entry;
      const copyItem = new PopupMenu.PopupMenuItem(_('Copy'));
      copyItem.connect('activate', () => scheduleMenuAction(() => onActivate(entry)));
      popup.addMenuItem(copyItem);

      const pinItem = new PopupMenu.PopupMenuItem(this._entry.pinned ? _('Unpin') : _('Pin'));
      pinItem.connect('activate', () => scheduleMenuAction(() => onTogglePin(entry.id)));
      popup.addMenuItem(pinItem);

      const deleteItem = new PopupMenu.PopupMenuItem(_('Delete'));
      deleteItem.connect('activate', () => scheduleMenuAction(() => onRemove(entry.id)));
      popup.addMenuItem(deleteItem);

      const manager = new PopupMenu.PopupMenuManager(this);
      manager.addMenu(popup);

      popup.actor.hide();
      // uiGroup queues its children directly for relayout. Keep the BoxPointer
      // in a layout-managed parent so it can be destroyed between frames.
      const host = new Clutter.Actor({
        name: 'aurora-clipboard-item-menu-host',
        layout_manager: new Clutter.FixedLayout(),
      });
      host.add_child(popup.actor);
      Main.uiGroup.add_child(host);

      return { popup, manager, host };
    }

    private _destroyMenu(): void {
      if (!this._menu) return;

      const { popup, manager, host } = this._menu;
      this._menu = null;

      popup.close({ animate: false });
      manager.removeMenu(popup);
      popup.destroy();
      host.destroy();
    }
  },
);

export type ClipboardItem = InstanceType<typeof ClipboardItem>;
