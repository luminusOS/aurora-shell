// src/modules/trayIcons/trayContainer.ts
import '@girs/gjs';

import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import GLib from '@girs/glib-2.0';
import * as PanelMenu from '@girs/gnome-shell/ui/panelMenu';

import {
  createTrayState,
  toggleCollapsed,
  applyScroll,
  addAttention,
  clearAttention,
} from './trayState.ts';
import type { TrayState, TrayItem } from './trayState.ts';
import { TrayIconItem, destroyTooltip } from './trayIconItem.ts';

const SCROLL_STEP = 28;
const ICON_GAP = 3;
const ITEM_PADDING = 3; // Must match .aurora-tray-icon-item padding in SCSS

// St.Bin (BinLayout) clamps child to MIN(natural, available) — icons shrink when
// collapsed. OverflowClip overrides vfunc_allocate to give the child its full
// natural width; clip_to_allocation handles the visual cropping.
@GObject.registerClass({ GTypeName: 'AuroraTrayOverflowClip' })
class OverflowClip extends St.Widget {
  override vfunc_allocate(box: Clutter.ActorBox): void {
    this.set_allocation(box);
    const child = this.get_first_child();
    if (!child) return;
    const [, rawNatW] = child.get_preferred_width(-1);
    const [, rawNatH] = child.get_preferred_height(rawNatW);
    const natW = Number.isFinite(rawNatW) && rawNatW >= 0 ? rawNatW : 0;
    const natH = Number.isFinite(rawNatH) && rawNatH >= 0 ? rawNatH : 0;
    const childBox = new Clutter.ActorBox();
    childBox.x1 = 0;
    childBox.y1 = 0;
    childBox.x2 = natW;
    childBox.y2 = Math.max(natH, box.y2 - box.y1);
    child.allocate(childBox);
  }
}

@GObject.registerClass
export class TrayContainer extends PanelMenu.Button {
  declare private _state: TrayState;
  declare private _iconSize: number;
  declare private _limit: number;
  declare private _items: Map<string, TrayIconItem>;
  declare private _chevron: St.Button;
  declare private _chevronIcon: St.Icon;
  declare private _clipArea: OverflowClip;
  declare private _iconRow: St.BoxLayout;
  declare private _userInteracted: boolean;
  declare private _attentionTimeoutSeconds: number;
  declare private _autoCollapseTimeoutId: number;

  // @ts-expect-error Our _init signature differs from PanelMenu.Button._init overloads,
  // which is the standard GJS GObject subclassing pattern when using custom constructor args.
  override _init(iconSize: number, limit: number): void {
    super._init(0.0, 'aurora-tray-icons', true); // dontCreateMenu = true
    this.track_hover = false; // highlight only individual icon items, not the whole button area
    this._state = createTrayState();
    this._iconSize = iconSize;
    this._limit = limit;
    this._items = new Map();
    this._userInteracted = false;
    this._attentionTimeoutSeconds = 5;
    this._autoCollapseTimeoutId = 0;

    // Chevron button (collapse/expand toggle)
    this._chevronIcon = new St.Icon({
      icon_name: 'pan-end-symbolic',
      icon_size: 14,
      style_class: 'aurora-tray-chevron-icon',
    });
    this._chevronIcon.set_pivot_point(0.5, 0.5);
    this._chevronIcon.rotation_angle_z = 180; // starts collapsed → pointing left
    this._chevron = new St.Button({
      child: this._chevronIcon,
      style_class: 'aurora-tray-chevron',
      can_focus: true,
      visible: false,
    });
    this._chevron.connect('clicked', () => {
      this._userInteracted = true;
      toggleCollapsed(this._state);
      this._syncLayout();
    });

    // Clip area: OverflowClip allocates _iconRow at full natural width so icons
    // never shrink when collapsed; clip_to_allocation handles visual cropping.
    this._iconRow = new St.BoxLayout({
      style_class: 'aurora-tray-icon-row',
    });
    (this._iconRow.layout_manager as Clutter.BoxLayout).spacing = ICON_GAP;
    this._clipArea = new (OverflowClip as unknown as new (params: object) => OverflowClip)({
      x_expand: false,
      y_expand: true,
      clip_to_allocation: true,
    });
    this._clipArea.add_child(this._iconRow);

    // Outer layout
    const outerBox = new St.BoxLayout({
      style_class: 'aurora-tray-container',
    });
    outerBox.add_child(this._chevron);
    outerBox.add_child(this._clipArea);
    this.add_child(outerBox);

    // Scroll to peek
    this.connect('scroll-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
      if (!this._state.collapsed) return Clutter.EVENT_PROPAGATE;
      this._userInteracted = true;
      const direction = event.get_scroll_direction();
      const delta = direction === Clutter.ScrollDirection.UP ? SCROLL_STEP : -SCROLL_STEP;
      applyScroll(this._state, delta, this._maxScroll());
      this._syncScrollPosition();
      return Clutter.EVENT_STOP;
    });
  }

  private _itemWidth(): number {
    return this._iconSize + 2 * ITEM_PADDING;
  }

  private _maxScroll(): number {
    const hiddenCount = Math.max(0, this._items.size - this._limit);
    return hiddenCount * (this._itemWidth() + ICON_GAP);
  }

  addItem(item: TrayItem): void {
    // Prevent duplicates
    this.removeItem(item.id);

    const widget = new (TrayIconItem as unknown as new (
      item: TrayItem,
      iconSize: number,
    ) => TrayIconItem)(item, this._iconSize);
    this._items.set(item.id, widget);
    this._iconRow.add_child(widget);
    this._syncLayout();

    // Pop-in: scale 0.5→1.1→1.0, opacity 0→255 (~380ms total)
    widget.set_pivot_point(0.5, 0.5);
    widget.set_scale(0.5, 0.5);
    widget.opacity = 0;
    widget.ease({
      scaleX: 1.1,
      scaleY: 1.1,
      opacity: 255,
      duration: 250,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        widget.ease({
          scaleX: 1.0,
          scaleY: 1.0,
          duration: 130,
          mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });
      },
    });
  }

  updateItemIcon(id: string): void {
    this._items.get(id)?.updateIcon();
  }

  removeItem(id: string): void {
    const widget = this._items.get(id);
    if (!widget) return;
    this._items.delete(id);

    // Pop-out: scale→0.5, opacity→0, then remove from DOM and sync layout
    widget.set_pivot_point(0.5, 0.5);
    widget.ease({
      scaleX: 0.5,
      scaleY: 0.5,
      opacity: 0,
      duration: 280,
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => {
        this._iconRow.remove_child(widget);
        widget.destroy();
        this._syncLayout();
      },
    });
  }

  notifyAttention(id: string): void {
    addAttention(this._state, id);
    const widget = this._items.get(id);

    // Auto-expand if the item is not visible
    const visibleIds = this._visibleIds();
    const isHidden = !visibleIds.has(id);
    if (isHidden && this._state.collapsed) {
      this._state.collapsed = false;
      this._syncLayout();
    }

    widget?.showBadge();
    widget?.bounce();

    // Auto-collapse after timeout (set by trayIcons.ts via setAttentionTimeout)
    this._scheduleAutoCollapse();
  }

  clearAttentionBadge(id: string): void {
    clearAttention(this._state, id);
    this._items.get(id)?.hideBadge();
  }

  setLimit(limit: number): void {
    this._limit = limit;
    this._syncLayout();
  }

  setIconSize(size: number): void {
    this._iconSize = size;
    for (const widget of this._items.values()) {
      widget.setIconSize(size);
    }
    this._syncLayout();
  }

  setAttentionTimeout(seconds: number): void {
    this._attentionTimeoutSeconds = seconds;
  }

  private _scheduleAutoCollapse(): void {
    if (this._autoCollapseTimeoutId) {
      GLib.Source.remove(this._autoCollapseTimeoutId);
      this._autoCollapseTimeoutId = 0;
    }
    this._autoCollapseTimeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      this._attentionTimeoutSeconds,
      () => {
        this._autoCollapseTimeoutId = 0;
        if (!this._userInteracted && !this._state.collapsed) {
          this._state.collapsed = true;
          this._syncLayout();
        }
        this._userInteracted = false; // reset for next attention cycle
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  private _visibleIds(): Set<string> {
    const keys = [...this._items.keys()];
    return new Set(keys.slice(Math.max(0, keys.length - this._limit)));
  }

  private _syncLayout(): void {
    const count = this._items.size;
    this.visible = count > 0;
    const hasOverflow = count > this._limit;
    this._chevron.visible = hasOverflow;

    // Chevron rotation: 0° = expanded (points right), 180° = collapsed (points left)
    this._chevronIcon.ease({
      rotationAngleZ: this._state.collapsed ? 180 : 0,
      duration: 350,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });

    // Collapsed: scroll to end so the newest (last) _limit icons are visible.
    // Expanded: scroll back to origin.
    if (this._state.collapsed) {
      this._state.scrollOffset = this._maxScroll();
    } else {
      this._state.scrollOffset = 0;
    }

    const itemW = this._itemWidth();
    const fullWidth = count > 0 ? count * itemW + (count - 1) * ICON_GAP : 0;
    const collapsedWidth =
      count > 0
        ? Math.min(count, this._limit) * itemW + (Math.min(count, this._limit) - 1) * ICON_GAP
        : 0;

    const targetWidth = this._state.collapsed ? collapsedWidth : fullWidth;
    const currentWidth = this._clipArea.get_width();

    if (count === 0) {
      this._clipArea.remove_all_transitions();
      this._clipArea.set_width(0);
      this._syncScrollPosition();
      return;
    }

    // Animate clip width on change; set immediately if already correct.
    if (Math.abs(currentWidth - targetWidth) < 1) {
      this._clipArea.set_width(targetWidth);
    } else {
      this._clipArea.ease({
        naturalWidth: targetWidth,
        duration: 400,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      });
    }

    // Fade/slide overflow icons: hidden ones fade out, newly visible ones slide in.
    const hiddenCount = Math.max(0, count - this._limit);
    const allWidgets = [...this._items.values()];
    for (let i = 0; i < allWidgets.length; i++) {
      const widget = allWidgets[i]!;
      const targetOpacity = i < hiddenCount && this._state.collapsed ? 0 : 255;
      if (widget.opacity !== targetOpacity) {
        if (targetOpacity === 255) {
          // Appearing on expand: slide in from left with fade
          widget.translationX = -10;
          widget.ease({
            opacity: 255,
            translationX: 0,
            duration: 400,
            delay: 60,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
          });
        } else {
          // Disappearing on collapse: fade out
          widget.ease({
            opacity: 0,
            duration: 200,
            delay: 60,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          });
        }
      }
    }

    this._syncScrollPosition();
  }

  private _syncScrollPosition(): void {
    this._iconRow.ease({
      translationX: -this._state.scrollOffset,
      duration: 120,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });
  }

  override destroy(): void {
    if (this._autoCollapseTimeoutId) {
      GLib.Source.remove(this._autoCollapseTimeoutId);
      this._autoCollapseTimeoutId = 0;
    }
    destroyTooltip();
    for (const widget of this._items.values()) widget.destroy();
    this._items.clear();
    super.destroy();
  }
}
