// src/modules/trayIcons/trayIconItem.ts
import '@girs/gjs';

import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import type Gio from '@girs/gio-2.0';
import GdkPixbuf from '@girs/gdkpixbuf-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
import * as PopupMenu from '@girs/gnome-shell/ui/popupMenu';
import { PopupAnimation } from '@girs/gnome-shell/ui/boxpointer';
import { logger } from '~/core/logger.ts';

import type { TrayItem } from './trayState.ts';
import { DBusMenuClient } from './dbusMenu.ts';

const BADGE_SIZE = 6;
const BOUNCE_DURATION = 1400;
const LOG_PREFIX = 'AuroraTray';

// Module-level tooltip shared by all TrayIconItems to avoid allocating one per icon.
let _tooltipLabel: St.Label | null = null;
const _menuManagers = new WeakMap<PopupMenu.PopupMenu, PopupMenu.PopupMenuManager>();

function _showTooltip(anchor: Clutter.Actor, text: string): void {
  if (!_tooltipLabel) {
    _tooltipLabel = new St.Label({ style_class: 'aurora-tray-tooltip', visible: false });
    Main.uiGroup.add_child(_tooltipLabel);
  }
  _tooltipLabel.text = text;
  _tooltipLabel.show();

  // Position: horizontally centred below the anchor, clamped to the monitor.
  const monitor = Main.layoutManager.findMonitorForActor(anchor);
  const [ax, ay] = anchor.get_transformed_position();
  const [aw, ah] = anchor.get_transformed_size();
  _tooltipLabel.ensure_style();
  const tw = _tooltipLabel.width;
  const tx = monitor
    ? Math.max(monitor.x, Math.min(ax + aw / 2 - tw / 2, monitor.x + monitor.width - tw))
    : ax + aw / 2 - tw / 2;
  _tooltipLabel.set_position(Math.round(tx), Math.round(ay + ah + 4));
}

function _hideTooltip(): void {
  _tooltipLabel?.hide();
}

export function destroyTooltip(): void {
  if (_tooltipLabel) {
    Main.uiGroup.remove_child(_tooltipLabel);
    _tooltipLabel.destroy();
    _tooltipLabel = null;
  }
}

@GObject.registerClass
export class TrayIconItem extends St.Button {
  declare private _trayItem: TrayItem;
  declare private _iconWidget: St.Icon;
  declare private _badge: St.Widget;
  declare private _iconSize: number;
  declare private _menu: PopupMenu.PopupMenu | null;
  declare private _dbusMenuClient: DBusMenuClient | null;
  declare private _localMenu: PopupMenu.PopupMenu | null;

  override _init(item: TrayItem, iconSize: number): void {
    super._init({
      style_class: 'aurora-tray-icon-item',
      button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
      can_focus: true,
      track_hover: true,
    });

    this._trayItem = item;
    this._iconSize = iconSize;
    this._menu = null;
    this._dbusMenuClient = null;
    this._localMenu = null;

    if (item.menuBusName && item.menuObjectPath) {
      this._dbusMenuClient = new DBusMenuClient(item.menuBusName, item.menuObjectPath);
      this._menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
      this._menu.actor.add_style_class_name('aurora-tray-menu');
      this._addManagedMenu(this._menu);

      Main.uiGroup.add_child(this._menu.actor);
      this._menu.actor.hide();
    }

    if (item.menuItems && item.menuItems.length > 0) {
      this._localMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
      this._localMenu.actor.add_style_class_name('aurora-tray-menu');
      this._addManagedMenu(this._localMenu);
      Main.uiGroup.add_child(this._localMenu.actor);
      this._localMenu.actor.hide();

      for (const mi of item.menuItems) {
        const entry = new PopupMenu.PopupMenuItem(mi.label);
        entry.connect('activate', () => mi.action());
        this._localMenu.addMenuItem(entry);
      }
    }

    const box = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      reactive: false,
    });
    this.set_child(box);

    this._iconWidget = new St.Icon({
      icon_size: iconSize,
      fallback_icon_name: 'image-missing-symbolic',
      reactive: false,
    });
    box.add_child(this._iconWidget);

    this._applyIcon();

    this._badge = new St.Widget({
      style: `width: ${BADGE_SIZE}px; height: ${BADGE_SIZE}px;`,
      style_class: 'aurora-tray-attention-badge',
      visible: false,
      reactive: false,
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.START,
    });
    this._badge.set_pivot_point(0.5, 0.5);
    box.add_child(this._badge);

    this.connect('notify::hover', () => {
      const label = this._trayItem.tooltip;
      if (this.hover && label) {
        _showTooltip(this, label);
      } else {
        _hideTooltip();
      }
    });

    this.connect('button-press-event', (_actor: St.Button, event: Clutter.Event) => {
      const btn = event.get_button();
      const [x, y] = this.get_transformed_position();
      const [w, h] = this.get_transformed_size();
      const centerX = x + w / 2;
      const centerY = y + h / 2;

      if (btn === 3 && this._dbusMenuClient && this._menu) {
        if (this._menu.isOpen) {
          this._menu.close(PopupAnimation.FULL);
        } else {
          this._showDbusMenu();
        }
        return Clutter.EVENT_STOP;
      }

      if (btn === 3 && this._localMenu) {
        if (this._localMenu.isOpen) {
          this._localMenu.close(PopupAnimation.FULL);
        } else {
          this._localMenu.open(PopupAnimation.FULL);
        }
        return Clutter.EVENT_STOP;
      }

      if (btn === 1) {
        this._trayItem.activate(centerX, centerY);
      } else if (btn === 2) {
        this._trayItem.secondaryActivate?.(centerX, centerY);
      } else if (btn === 3) {
        this._trayItem.showMenu?.(centerX, centerY);
      }
      return Clutter.EVENT_STOP;
    });
  }

  private _addManagedMenu(menu: PopupMenu.PopupMenu): void {
    const manager = new PopupMenu.PopupMenuManager(this);
    manager.addMenu(menu);
    _menuManagers.set(menu, manager);
  }

  private _removeManagedMenu(menu: PopupMenu.PopupMenu): void {
    const manager = _menuManagers.get(menu);
    if (!manager) return;

    manager.removeMenu(menu);
    _menuManagers.delete(menu);
  }

  private async _showDbusMenu(): Promise<void> {
    if (!this._dbusMenuClient || !this._menu) return;

    try {
      await this._dbusMenuClient.init();
      await this._dbusMenuClient.updateMenu(this._menu);
      this._menu.open(PopupAnimation.FULL);
    } catch (e) {
      logger.warn(`_showDbusMenu failed: ${e}`, { prefix: LOG_PREFIX });
    }
  }

  private _applyIcon(): void {
    const icon = this._trayItem.icon;

    if (typeof icon === 'string') {
      this._iconWidget.icon_name = icon;
    } else if (icon instanceof GdkPixbuf.Pixbuf) {
      // St.Icon does not auto-scale raw GdkPixbuf gicons — scale to iconSize
      // so pixmap-based SNI icons render at the correct pixel size.
      const scaled =
        icon.scale_simple(this._iconSize, this._iconSize, GdkPixbuf.InterpType.BILINEAR) ?? icon;
      this._iconWidget.gicon = scaled as unknown as Gio.Icon;
    } else {
      this._iconWidget.gicon = icon;
    }
  }

  updateIcon(): void {
    this._applyIcon();
  }

  setIconSize(size: number): void {
    this._iconSize = size;
    this._iconWidget.set_icon_size(size);
  }

  showBadge(): void {
    this._badge.remove_all_transitions();
    this._badge.set_scale(0, 0);
    this._badge.opacity = 0;
    this._badge.visible = true;
    this._badge.ease({
      scaleX: 1.0,
      scaleY: 1.0,
      opacity: 255,
      duration: 450,
      mode: Clutter.AnimationMode.EASE_OUT_BACK,
    });
  }

  hideBadge(): void {
    this._badge.remove_all_transitions();
    this._badge.ease({
      scaleX: 0,
      scaleY: 0,
      opacity: 0,
      duration: 300,
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => {
        this._badge.visible = false;
        this._badge.set_scale(1, 1);
        this._badge.opacity = 255;
      },
    });
  }

  bounce(): void {
    this.remove_transition('bounce');
    const transition = new Clutter.KeyframeTransition({ property_name: 'translation-y' });
    transition.set_duration(BOUNCE_DURATION);
    transition.set_from(0);
    transition.set_to(0);
    transition.set_key_frames([0.13, 0.25, 0.4, 0.52, 0.65, 0.78]);
    transition.set_values([-6, 0, -4, 0, -2, 0]);
    this.add_transition('bounce', transition);
  }

  get trayItem(): TrayItem {
    return this._trayItem;
  }

  override destroy(): void {
    _hideTooltip();
    if (this._dbusMenuClient) this._dbusMenuClient.destroy();
    this._dbusMenuClient = null;
    if (this._menu) this._removeManagedMenu(this._menu);
    if (this._menu) this._menu.destroy();
    this._menu = null;
    if (this._localMenu) this._removeManagedMenu(this._localMenu);
    if (this._localMenu) this._localMenu.destroy();
    this._localMenu = null;
    this._badge.destroy();
    this._iconWidget.destroy();
    this._trayItem.destroy();
    super.destroy();
  }
}
