// src/modules/trayIcons/trayContainer.ts
import '@girs/gjs';

import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import GLib from '@girs/glib-2.0';
import * as PanelMenu from '@girs/gnome-shell/ui/panelMenu';

import { logger } from '~/core/logger.ts';

import { createTrayState, toggleCollapsed, addAttention, clearAttention } from './trayState.ts';
import type { TrayState, TrayItem } from './trayState.ts';
import { TrayIconItem, destroyTooltip } from './trayIconItem.ts';

const ICON_GAP = 3;
const ITEM_PADDING = 3; // Must match .aurora-tray-icon-item padding in SCSS
const ANIM_DURATION = 600;
const PANEL_SAFETY_GAP = 8;
const LOG_PREFIX = 'AuroraTray';

@GObject.registerClass
class TrayClipArea extends Clutter.Actor {
  public fullWidth = 0;
  public reservedWidth = 0;
  private _childOffsetX = 0;
  private _viewportWidth = 0;
  private _clipStart = 0;
  private _viewportTimeoutId = 0;

  override _init(params = {}) {
    super._init({
      clip_to_allocation: false,
      x_expand: false,
      y_expand: true,
      ...params,
    });
  }

  override vfunc_allocate(box: Clutter.ActorBox): void {
    super.vfunc_allocate(box);
    const ownH = Math.round(box.y2 - box.y1);
    const childW = Math.round(this.fullWidth);
    const childX = Math.round(this._childOffsetX);

    this._syncClip();

    const childBox = new Clutter.ActorBox();
    childBox.set_origin(childX, 0);
    childBox.set_size(childW, ownH);
    for (const child of this.get_children()) {
      child.allocate(childBox);
    }
  }

  private _syncClip(): void {
    const reservedWidth = Math.round(this.reservedWidth);
    const clipStart = Math.min(reservedWidth, Math.max(0, Math.round(this._clipStart)));
    const visibleWidth = Math.min(
      reservedWidth - clipStart,
      Math.max(0, Math.round(this._viewportWidth)),
    );
    const height = Math.max(0, Math.round(this.height));
    this.set_clip(clipStart, 0, visibleWidth, height);
  }

  setViewport(
    fullWidth: number,
    viewportWidth: number,
    clipStart: number,
    reservedWidth = fullWidth,
  ): void {
    this.fullWidth = Math.round(fullWidth);
    this.reservedWidth = Math.max(0, Math.round(reservedWidth));
    this._childOffsetX = Math.min(0, this.reservedWidth - this.fullWidth);
    this._viewportWidth = viewportWidth;
    this._clipStart = clipStart;
    this.set_width(this.reservedWidth);
    this._syncClip();
  }

  animateViewport(
    fromViewportWidth: number,
    fromClipStart: number,
    toViewportWidth: number,
    toClipStart: number,
    durationMs: number,
    onFrame: (viewportWidth: number, clipStart: number) => void,
    onComplete: () => void,
  ): void {
    this.cancelViewportAnimation();
    const startUs = GLib.get_monotonic_time();
    const durationUs = durationMs * 1000;
    const viewportDelta = toViewportWidth - fromViewportWidth;
    const clipStartDelta = toClipStart - fromClipStart;

    this._viewportTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
      const elapsedUs = GLib.get_monotonic_time() - startUs;
      const progress = Math.min(1, elapsedUs / durationUs);
      const eased = 1 - Math.pow(1 - progress, 3);

      this._viewportWidth = fromViewportWidth + viewportDelta * eased;
      this._clipStart = fromClipStart + clipStartDelta * eased;
      this._syncClip();
      onFrame(this._viewportWidth, this._clipStart);

      if (progress < 1) return GLib.SOURCE_CONTINUE;

      this._viewportTimeoutId = 0;
      this._viewportWidth = toViewportWidth;
      this._clipStart = toClipStart;
      this._syncClip();
      onFrame(toViewportWidth, toClipStart);
      onComplete();
      return GLib.SOURCE_REMOVE;
    });
  }

  cancelViewportAnimation(): void {
    if (this._viewportTimeoutId > 0) {
      GLib.Source.remove(this._viewportTimeoutId);
      this._viewportTimeoutId = 0;
    }
  }

  get viewportWidth(): number {
    return this._viewportWidth;
  }

  get clipStart(): number {
    return this._clipStart;
  }

  layoutSnapshot(): string {
    const child = this.get_first_child();
    return `reservedWidth=${Math.round(this.reservedWidth)} actorWidth=${Math.round(this.width)} viewportWidth=${Math.round(this._viewportWidth)} clipStart=${Math.round(this._clipStart)} allocated=${Math.round(this.allocation.x2 - this.allocation.x1)} fullWidth=${Math.round(this.fullWidth)} childOffsetX=${Math.round(this._childOffsetX)} childX=${child ? Math.round(child.x) : 'none'} childWidth=${child ? Math.round(child.width) : 'none'}`;
  }
}

@GObject.registerClass
export class TrayContainer extends PanelMenu.Button {
  static [GObject.properties] = {
    'anim-scroll': GObject.ParamSpec.double(
      'anim-scroll',
      'anim-scroll',
      'Animated scroll position snapped to pixels',
      GObject.ParamFlags.READWRITE,
      -10000,
      10000,
      0,
    ),
  };

  declare private _state: TrayState;
  declare private _iconSize: number;
  declare private _limit: number;
  declare private _items: Map<string, TrayIconItem>;
  declare private _chevron: St.Button;
  declare private _chevronIcon: St.Icon;
  declare private _clipArea: TrayClipArea;
  declare private _iconRow: St.BoxLayout;
  declare private _outerBox: St.BoxLayout;
  declare private _userInteracted: boolean;
  declare private _attentionTimeoutSeconds: number;
  declare private _autoCollapseTimeoutId: number;
  declare private _debugPostAllocateId: number;
  declare private _opacityTargets: WeakMap<TrayIconItem, number>;
  declare private _scrollTarget: number;
  declare private _smoothScrollAccumulator: number;

  private _animScrollValue = 0;

  get anim_scroll(): number {
    return this._animScrollValue;
  }

  set anim_scroll(v: number) {
    this._animScrollValue = v;
    const rounded = Math.round(v);
    if (this._iconRow.translationX !== rounded) {
      this._iconRow.translationX = rounded;
    }
  }

  override vfunc_allocate(box: Clutter.ActorBox): void {
    // Snap the box to integer pixels to avoid parent BoxLayout sub-pixel jitter.
    box.x1 = Math.round(box.x1);
    box.x2 = Math.round(box.x2);
    box.y1 = Math.round(box.y1);
    box.y2 = Math.round(box.y2);
    super.vfunc_allocate(box);
  }

  // @ts-expect-error Our _init signature differs from PanelMenu.Button._init overloads,
  // which is the standard GJS GObject subclassing pattern when using custom constructor args.
  override _init(iconSize: number, limit: number): void {
    super._init(0.0, 'aurora-tray-icons', true); // dontCreateMenu = true
    this.add_style_class_name('aurora-tray-button');
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
    this._smoothScrollAccumulator = 0;
    this._debugPostAllocateId = 0;

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
      logger.log(`Chevron toggled collapsed=${this._state.collapsed}`, { prefix: LOG_PREFIX });
      this._syncLayout(true);
    });

    this._iconRow = new St.BoxLayout({
      style_class: 'aurora-tray-icon-row',
    });
    (this._iconRow.layout_manager as Clutter.BoxLayout).spacing = ICON_GAP;

    this._clipArea = new TrayClipArea();
    this._clipArea.add_child(this._iconRow);

    // Outer layout
    this._outerBox = new St.BoxLayout({
      style_class: 'aurora-tray-container',
    });
    this._outerBox.add_child(this._chevron);
    this._outerBox.add_child(this._clipArea);
    this.add_child(this._outerBox);

    // Scroll to peek
    this.connect('scroll-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
      if (!this._canScrollIcons()) return Clutter.EVENT_PROPAGATE;
      const direction = event.get_scroll_direction();
      if (direction === Clutter.ScrollDirection.SMOOTH) {
        const [dx, dy] = event.get_scroll_delta();
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        this._smoothScrollAccumulator += delta;
        if (Math.abs(this._smoothScrollAccumulator) < 1) return Clutter.EVENT_STOP;
        if (!this._scrollByItems(this._smoothScrollAccumulator > 0 ? -1 : 1))
          return Clutter.EVENT_PROPAGATE;
        this._smoothScrollAccumulator = 0;
        return Clutter.EVENT_STOP;
      }

      const deltaItems =
        direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT
          ? 1
          : -1;
      return this._scrollByItems(deltaItems) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    });
  }

  private _itemWidth(): number {
    return this._iconSize + 2 * ITEM_PADDING;
  }

  private _maxScroll(): number {
    return this._maxScrollForLimit(this._effectiveLimit());
  }

  private _maxExpandedScroll(): number {
    return Math.max(0, Math.round(this._clipArea.fullWidth - this._clipArea.reservedWidth));
  }

  private _maxScrollForLimit(limit: number): number {
    const hiddenCount = Math.max(0, this._items.size - limit);
    return hiddenCount * (this._itemWidth() + ICON_GAP);
  }

  private _effectiveLimit(maxClipWidth = this._availableClipWidth(true)): number {
    if (maxClipWidth === null) return this._limit;

    const itemStride = this._itemWidth() + ICON_GAP;
    const maxVisibleByWidth = Math.max(1, Math.floor((maxClipWidth + ICON_GAP) / itemStride));
    return Math.max(1, Math.min(this._limit, maxVisibleByWidth));
  }

  private _availableClipWidth(includeChevron: boolean): number | null {
    const panelContainer =
      (this as unknown as { container?: Clutter.Actor }).container ?? (this as Clutter.Actor);
    const parent = panelContainer.get_parent();
    if (!parent) return null;

    const parentWidth = this._availablePanelSideWidth(parent);
    if (parentWidth <= 0) return null;

    let siblingsWidth = 0;
    for (const child of parent.get_children()) {
      if (child === panelContainer || !child.visible) continue;
      const [, naturalWidth] = child.get_preferred_width(-1);
      siblingsWidth += Math.ceil(naturalWidth);
    }

    const [, chevronWidth] = includeChevron ? this._chevron.get_preferred_width(-1) : [0, 0];
    const availableWidth =
      parentWidth -
      siblingsWidth -
      Math.ceil(chevronWidth) -
      (includeChevron ? ICON_GAP : 0) -
      PANEL_SAFETY_GAP;
    return Math.max(this._itemWidth(), Math.floor(availableWidth));
  }

  private _availablePanelSideWidth(parent: Clutter.Actor): number {
    const fallbackWidth = Math.round(parent.allocation.x2 - parent.allocation.x1);
    const panel = parent.get_parent() as (Clutter.Actor & { _centerBox?: Clutter.Actor }) | null;
    const centerBox = panel?._centerBox;
    if (!centerBox) return fallbackWidth;

    if (this.get_text_direction() === Clutter.TextDirection.RTL) {
      return Math.max(fallbackWidth, Math.round(centerBox.allocation.x1 - parent.allocation.x1));
    }

    return Math.max(fallbackWidth, Math.round(parent.allocation.x2 - centerBox.allocation.x2));
  }

  private _canScrollIcons(): boolean {
    return this._state.collapsed ? this._maxScroll() > 0 : this._maxExpandedScroll() > 0;
  }

  private _scrollByItems(deltaItems: number): boolean {
    const maxScroll = this._state.collapsed ? this._maxScroll() : this._maxExpandedScroll();
    if (maxScroll <= 0) return false;

    this._userInteracted = true;
    const itemStride = this._itemWidth() + ICON_GAP;
    const signedDelta = this._state.collapsed ? deltaItems : -deltaItems;
    this._state.scrollOffset = Math.max(
      0,
      Math.min(maxScroll, this._state.scrollOffset + signedDelta * itemStride),
    );
    this._syncScrollPosition();
    this._applyIconOpacity();
    return true;
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
    const limit = this._effectiveLimit();
    const hiddenCount = Math.max(0, keys.length - limit);
    const itemStride = this._itemWidth() + ICON_GAP;
    const startIndex =
      itemStride > 0
        ? Math.max(0, Math.min(hiddenCount, Math.round(this._state.scrollOffset / itemStride)))
        : hiddenCount;
    return new Set(keys.slice(startIndex, startIndex + limit));
  }

  private _syncLayout(animated = false): void {
    const count = this._items.size;
    this.visible = count > 0;
    const itemW = this._itemWidth();
    const fullWidth = count * itemW + Math.max(0, count - 1) * ICON_GAP;
    const availableClipWidthWithoutChevron = this._availableClipWidth(false);
    const effectiveLimitWithoutChevron = this._effectiveLimit(availableClipWidthWithoutChevron);
    const shouldReserveChevron = count > effectiveLimitWithoutChevron;
    const availableClipWidth = this._availableClipWidth(shouldReserveChevron);
    const effectiveLimit = this._effectiveLimit(availableClipWidth);
    const hasOverflow = count > effectiveLimit;
    this._chevron.visible = hasOverflow;

    // Chevron rotation: 0° = expanded (points right), 180° = collapsed (points left).
    this._chevronIcon.ease({
      rotationAngleZ: this._state.collapsed ? 180 : 0,
      duration: animated ? ANIM_DURATION : 0,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });

    const visibleCount = Math.min(count, effectiveLimit);
    const collapsedWidth = visibleCount * itemW + Math.max(0, visibleCount - 1) * ICON_GAP;
    const reservedWidth =
      availableClipWidth === null
        ? fullWidth
        : Math.min(fullWidth, Math.max(collapsedWidth, availableClipWidth));
    const collapsedClipStart = Math.max(0, reservedWidth - collapsedWidth);

    // collapsed -> maxScroll anchors the row to newest icons (right-aligned in clip).
    // expanded -> 0 resets any manual scroll.
    this._state.scrollOffset = this._state.collapsed ? this._maxScrollForLimit(effectiveLimit) : 0;
    if (!this._state.collapsed) this._smoothScrollAccumulator = 0;

    const targetViewportWidth = Math.round(this._state.collapsed ? collapsedWidth : reservedWidth);
    const targetClipStart = Math.round(this._state.collapsed ? collapsedClipStart : 0);
    const startViewportWidth = Math.round(this._clipArea.viewportWidth || targetViewportWidth);
    const startClipStart = Math.round(this._clipArea.clipStart);

    if (animated) {
      logger.log(
        `Viewport animation collapsed=${this._state.collapsed} count=${count} limit=${this._limit} effectiveLimit=${effectiveLimit} visible=${visibleCount} fullWidth=${fullWidth} reservedWidth=${reservedWidth} availableClipWidth=${availableClipWidth ?? 'none'} fromViewport=${startViewportWidth} toViewport=${targetViewportWidth} fromClipStart=${startClipStart} toClipStart=${targetClipStart} scrollOffset=${this._state.scrollOffset} chevronX=${Math.round(this._chevron.translationX)} ${this._clipArea.layoutSnapshot()}`,
        { prefix: LOG_PREFIX },
      );
    }

    if (count === 0) {
      this._clipArea.remove_all_transitions();
      this._clipArea.cancelViewportAnimation();
      this._clipArea.setViewport(0, 0, 0);
      this._outerBox.translationX = 0;
      this._setChevronAnchor(0);
      this._syncScrollPosition(0);
      return;
    }

    this._clipArea.remove_all_transitions();
    this._clipArea.cancelViewportAnimation();
    this._outerBox.translationX = 0;

    if (
      animated &&
      (startViewportWidth !== targetViewportWidth || startClipStart !== targetClipStart)
    ) {
      if (this._state.collapsed) {
        for (const widget of [...this._items.values()]) {
          widget.remove_transition('opacity');
          this._opacityTargets.set(widget, 255);
          widget.opacity = 255;
        }
      }
      this._clipArea.setViewport(fullWidth, startViewportWidth, startClipStart, reservedWidth);
      this._setChevronAnchor(startClipStart);
      this._clipArea.animateViewport(
        startViewportWidth,
        startClipStart,
        targetViewportWidth,
        targetClipStart,
        ANIM_DURATION,
        (_viewportWidth, clipStart) => {
          this._setChevronAnchor(clipStart);
        },
        () => {
          this._applyIconOpacity();
          logger.log(
            `Viewport animation complete chevronX=${Math.round(this._chevron.translationX)} ${this._clipArea.layoutSnapshot()}`,
            { prefix: LOG_PREFIX },
          );
        },
      );
      if (this._debugPostAllocateId > 0) GLib.Source.remove(this._debugPostAllocateId);
      this._debugPostAllocateId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        this._debugPostAllocateId = 0;
        logger.log(
          `Viewport post-allocate chevronX=${Math.round(this._chevron.translationX)} ${this._clipArea.layoutSnapshot()}`,
          { prefix: LOG_PREFIX },
        );
        return GLib.SOURCE_REMOVE;
      });
    } else {
      this._clipArea.setViewport(fullWidth, targetViewportWidth, targetClipStart, reservedWidth);
      this._setChevronAnchor(targetClipStart);
      this._applyIconOpacity();
    }

    if (animated && !this._state.collapsed) this._applyIconOpacity();

    this._syncScrollPosition(0);
  }

  private _setChevronAnchor(x: number): void {
    const rounded = Math.round(x);
    if (this._chevron.translationX !== rounded) this._chevron.translationX = rounded;
  }

  private _applyIconOpacity(): void {
    const visibleIds = this._visibleIds();
    for (const [id, widget] of this._items) {
      const targetOpacity = !this._state.collapsed || visibleIds.has(id) ? 255 : 0;
      if (this._opacityTargets.get(widget) === targetOpacity) continue;
      this._opacityTargets.set(widget, targetOpacity);
      widget.remove_transition('opacity');
      widget.opacity = targetOpacity;
    }
  }

  private _syncScrollPosition(duration = 150): void {
    // Right-aligned allocation shows newest icons at translationX=0. Positive
    // translationX shifts the row right, revealing older icons on the left.
    const targetX = this._state.collapsed
      ? this._maxScroll() - this._state.scrollOffset
      : this._state.scrollOffset;

    if (this._scrollTarget === targetX) return;
    this._scrollTarget = targetX;
    if (duration > 0) {
      logger.log(
        `Scroll animation collapsed=${this._state.collapsed} targetX=${targetX} maxScroll=${this._maxScroll()} offset=${this._state.scrollOffset} duration=${duration}`,
        { prefix: LOG_PREFIX },
      );
    }

    if (duration > 0) {
      this.remove_transition('anim-scroll');
      this.ease({
        anim_scroll: targetX,
        duration,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      } as Parameters<Clutter.Actor['ease']>[0] & { anim_scroll: number });
    } else {
      this.remove_transition('anim-scroll');
      this.anim_scroll = targetX;
    }
  }

  override destroy(): void {
    this._clipArea.cancelViewportAnimation();
    if (this._autoCollapseTimeoutId > 0) {
      GLib.Source.remove(this._autoCollapseTimeoutId);
      this._autoCollapseTimeoutId = 0;
    }
    if (this._debugPostAllocateId > 0) {
      GLib.Source.remove(this._debugPostAllocateId);
      this._debugPostAllocateId = 0;
    }
    destroyTooltip();
    for (const widget of this._items.values()) widget.destroy();
    this._items.clear();
    super.destroy();
  }
}
