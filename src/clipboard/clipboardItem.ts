import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import St from '@girs/st-18';
import GObject from '@girs/gobject-2.0';
import Clutter from '@girs/clutter-18';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';

import type { ClipboardEntry } from '~/clipboard/clipboardStore.ts';
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
};

const _menuManagers = new WeakMap<PopupMenu.PopupMenu, PopupMenu.PopupMenuManager>();

export const ClipboardItem = GObject.registerClass(
  class ClipboardItem extends St.Button {
    declare private _entry: ClipboardEntry;
    declare private _callbacks: ClipboardItemCallbacks;
    declare private _actions: St.BoxLayout;
    declare private _pinButton: St.Button;
    declare private _removeButton: St.Button;
    declare private _menuButton: St.Button;
    declare private _menu: PopupMenu.PopupMenu | null;

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

      if (this._entry.filePath) {
        this.style = `background-image: url("file://${this._entry.filePath}"); background-size: cover;`;
      }

      this.set_child(buildImageCard(this._entry, this._actions));
    }

    private _buildLinkCard(): void {
      const url = this._entry.text.trim();
      const parsed = parseClipboardUrl(url);
      if (!parsed) return;

      this.add_style_class_name('aurora-clipboard-item--link');
      this.set_child(buildLinkCard(parsed, this._actions));
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
      if (!this._menu) this._createMenu();
      this._menu?.toggle();
    }

    private _createMenu(): void {
      this._menu = new PopupMenu.PopupMenu(this._menuButton, 0.5, St.Side.TOP);
      this._menu.actor.add_style_class_name('aurora-clipboard-item-menu');

      const copyItem = new PopupMenu.PopupMenuItem(_('Copy'));
      copyItem.connect('activate', () => this._callbacks.onActivate(this._entry));
      this._menu.addMenuItem(copyItem);

      const pinItem = new PopupMenu.PopupMenuItem(this._entry.pinned ? _('Unpin') : _('Pin'));
      pinItem.connect('activate', () => this._callbacks.onTogglePin(this._entry.id));
      this._menu.addMenuItem(pinItem);

      const deleteItem = new PopupMenu.PopupMenuItem(_('Delete'));
      deleteItem.connect('activate', () => this._callbacks.onRemove(this._entry.id));
      this._menu.addMenuItem(deleteItem);

      const manager = new PopupMenu.PopupMenuManager(this);
      manager.addMenu(this._menu);
      _menuManagers.set(this._menu, manager);

      Main.uiGroup.add_child(this._menu.actor);
      this._menu.actor.hide();
    }

    private _destroyMenu(): void {
      if (!this._menu) return;

      const manager = _menuManagers.get(this._menu)!;
      manager.removeMenu(this._menu);
      _menuManagers.delete(this._menu);
      this._menu.destroy();
      this._menu = null;
    }
  },
);

export type ClipboardItem = InstanceType<typeof ClipboardItem>;
