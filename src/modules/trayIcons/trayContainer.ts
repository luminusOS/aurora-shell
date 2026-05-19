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
const STAGGER_MS = 50;
const ANIM_DURATION = 750;
const ICON_EXPAND_DURATION = 480;
const ICON_COLLAPSE_DURATION = 380;

@GObject.registerClass
export class TrayContainer extends PanelMenu.Button {
  declare private _state: TrayState;
  declare private _iconSize: number;
  declare private _limit: number;
  declare private _items: Map<string, TrayIconItem>;
  declare private _chevron: St.Button;
  declare private _chevronIcon: St.Icon;
  declare private _clipArea: Clutter.Actor;
  declare private _iconRow: St.BoxLayout;
  declare private _userInteracted: boolean;
  declare private _attentionTimeoutSeconds: number;
  declare private _autoCollapseTimeoutId: number;
  declare private _opacityTargets: WeakMap<TrayIconItem, number>;
  declare private _scrollTarget: number;
  declare private _staggerTimeoutIds: number[];

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
    this._opacityTargets = new WeakMap();
    this._scrollTarget = 0;
    this._staggerTimeoutIds = [];

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
      this._syncLayout(true);
    });

    // Clip area: Clutter.Actor without a layout manager naturally allows the child
    // (BoxLayout) to maintain its natural width while the container's width is
    // animated/clipped, avoiding both the Mutter layout crashes and icon squishing.
    this._iconRow = new St.BoxLayout({
      style_class: 'aurora-tray-icon-row',
    });
    (this._iconRow.layout_manager as Clutter.BoxLayout).spacing = ICON_GAP;

    this._clipArea = new Clutter.Actor({
      clip_to_allocation: true,
      x_expand: false,
      y_align: Clutter.ActorAlign.CENTER,
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
    // Immediate dedup removal — no pop-out animation to avoid _syncLayout conflicts
    const oldWidget = this._items.get(item.id);
    if (oldWidget) {
      this._items.delete(item.id);
      this._opacityTargets.delete(oldWidget);
      this._iconRow.remove_child(oldWidget);
      oldWidget.destroy();
    }

    const widget = new (TrayIconItem as unknown as new (
      item: TrayItem,
      iconSize: number,
    ) => TrayIconItem)(item, this._iconSize);
    this._items.set(item.id, widget);
    this._iconRow.add_child(widget);

    // Non-animated sync sets correct opacity immediately — no layout animation thrash.
    this._syncLayout(false);

    // Pop-in only for icons that ended up visible.
    if (widget.opacity === 255) {
      widget.set_pivot_point(0.5, 0.5);
      widget.set_scale(0.5, 0.5);
      widget.ease({
        scaleX: 1.0,
        scaleY: 1.0,
        duration: 500,
        mode: Clutter.AnimationMode.EASE_OUT_BACK,
      });
    }
  }

  updateItemIcon(id: string): void {
    this._items.get(id)?.updateIcon();
  }

  removeItem(id: string): void {
    const widget = this._items.get(id);
    if (!widget) return;
    this._items.delete(id);
    this._opacityTargets.delete(widget);

    // Pop-out: scale→0.5, opacity→0, then remove from DOM and sync layout.
    widget.set_pivot_point(0.5, 0.5);
    widget.ease({
      scaleX: 0.5,
      scaleY: 0.5,
      opacity: 0,
      duration: 400,
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => {
        this._iconRow.remove_child(widget);
        widget.destroy();
        this._syncLayout(false);
      },
    });
  }

  notifyAttention(id: string): void {
    addAttention(this._state, id);
    const widget = this._items.get(id);

    // Auto-expand if the item is not visible.
    const isHidden = !this._visibleIds().has(id);
    if (isHidden && this._state.collapsed) {
      this._state.collapsed = false;
      this._syncLayout(true);
    }

    widget?.showBadge();
    widget?.bounce();
    this._scheduleAutoCollapse();
  }

  clearAttentionBadge(id: string): void {
    clearAttention(this._state, id);
    this._items.get(id)?.hideBadge();
  }

  setLimit(limit: number): void {
    this._limit = limit;
    this._syncLayout(false);
  }

  setIconSize(size: number): void {
    this._iconSize = size;
    for (const widget of this._items.values()) {
      widget.setIconSize(size);
    }
    this._syncLayout(false);
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
          this._syncLayout(true);
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

  private _cancelStagger(): void {
    for (const id of this._staggerTimeoutIds) GLib.Source.remove(id);
    this._staggerTimeoutIds = [];
  }

  // animated=true  → stagger icons + ease clip (toggle / auto-expand / auto-collapse)
  // animated=false → immediate opacity + immediate clip (addItem / removeItem / setLimit / setIconSize)
  private _syncLayout(animated = false): void {
    if (animated) this._cancelStagger();
    const count = this._items.size;
    this.visible = count > 0;
    const hasOverflow = count > this._limit;
    this._chevron.visible = hasOverflow;

    // Chevron rotation: 0° = expanded (points right), 180° = collapsed (points left).
    this._chevronIcon.ease({
      rotationAngleZ: this._state.collapsed ? 180 : 0,
      duration: ANIM_DURATION,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });

    // Scroll offset: collapsed shows newest _limit icons; expanded shows all.
    this._state.scrollOffset = this._state.collapsed ? this._maxScroll() : 0;

    if (count === 0) {
      this._clipArea.remove_all_transitions();
      this._clipArea.set_width(0);
      this._syncScrollPosition();
      return;
    }

    // Clip width
    const itemW = this._itemWidth();
    const visibleCount = Math.min(count, this._limit);
    const collapsedWidth = visibleCount * itemW + (visibleCount - 1) * ICON_GAP;
    const fullWidth = count * itemW + (count - 1) * ICON_GAP;
    const targetWidth = Math.round(this._state.collapsed ? collapsedWidth : fullWidth);

    if (animated) {
      this._clipArea.ease({
        width: targetWidth,
        duration: ANIM_DURATION,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      });
    } else {
      this._clipArea.remove_all_transitions();
      this._clipArea.set_width(targetWidth);
    }

    // Per-icon opacity: stagger on toggle, immediate on structural changes.
    const hiddenCount = Math.max(0, count - this._limit);
    const allWidgets = [...this._items.values()];
    for (let i = 0; i < allWidgets.length; i++) {
      const widget = allWidgets[i]!;
      const targetOpacity = i < hiddenCount && this._state.collapsed ? 0 : 255;
      if (this._opacityTargets.get(widget) === targetOpacity) continue;
      this._opacityTargets.set(widget, targetOpacity);

      if (animated) {
        const capturedWidget = widget;
        const capturedTarget = targetOpacity;
        // Pacman effect: reveal/hide one by one as they pass the chevron.
        // Expand: icons enter from left next to chevron in order (hiddenCount-1) -> 0.
        // Collapse: icons exit to left past chevron in order 0 -> (hiddenCount-1).
        const delayMs =
          targetOpacity === 255
            ? Math.max(0, (hiddenCount - 1 - i) * STAGGER_MS)
            : Math.max(0, i * STAGGER_MS);
        const duration = targetOpacity === 255 ? ICON_EXPAND_DURATION : ICON_COLLAPSE_DURATION;
        const mode =
          targetOpacity === 255
            ? Clutter.AnimationMode.EASE_OUT_CUBIC
            : Clutter.AnimationMode.EASE_OUT_QUAD;

        if (delayMs === 0) {
          capturedWidget.ease({ opacity: capturedTarget, duration, mode });
        } else {
          this._staggerTimeoutIds.push(
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
              // Guard: cancel may have won the race.
              if (this._opacityTargets.get(capturedWidget) === capturedTarget)
                capturedWidget.ease({ opacity: capturedTarget, duration, mode });
              return GLib.SOURCE_REMOVE;
            }),
          );
        }
      } else {
        widget.opacity = targetOpacity;
      }
    }

    this._syncScrollPosition();
  }

  private _syncScrollPosition(): void {
    const targetX = -this._state.scrollOffset;
    if (this._scrollTarget === targetX) return;
    this._scrollTarget = targetX;
    this._iconRow.ease({
      translationX: targetX,
      duration: ANIM_DURATION,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });
  }

  override destroy(): void {
    this._cancelStagger();
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
