import '@girs/gjs';
import GLib from '@girs/glib-2.0';
import Clutter from '@girs/clutter-17';
import GObject from '@girs/gobject-2.0';
import type St from '@girs/st-17';
import * as Main from '@girs/gnome-shell/ui/main';
import { Dash } from '@girs/gnome-shell/ui/dash';

export interface DashBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Padding added around the dash bounds to form the target box used for intellihide overlap checks. */
const TARGET_BOX_PADDING = 8;

type TargetBoxListener = (bounds: DashBounds | null) => void;

const AUTOHIDE_TIMEOUT = 100;
const ANIMATION_TIME = 200;
const VISIBILITY_ANIMATION_TIME = 200;
const HIDE_SCALE = 0.98;
const EASE_DURATION_FACTOR = 0.8;
/** Horizontal padding (px) inside the dash container so icons don't touch the background edge. */
const DOCK_CONTENT_PADDING = 8;

interface AuroraDashParams {
  monitorIndex?: number;
}

/**
 * Custom Dash widget for Aurora Shell.
 *
 * Extends the default GNOME Shell Dash with autohide behavior, slide-in/out
 * animations, intellihide target-box tracking, and per-monitor positioning.
 */
@GObject.registerClass
export class AuroraDash extends Dash {
  private _monitorIndex = Main.layoutManager.primaryIndex;
  private _workArea: DashBounds | null = null;
  private _dashBounds: DashBounds | null = null;
  private _container: St.Bin | null = null;
  private _autohideTimeoutId = 0;
  private _delayEnsureAutoHideId = 0;
  private _blockAutoHideDelayId = 0;
  private _targetBox: DashBounds | null = null;
  private _blockAutoHide = false;
  private _draggingItem = false;
  private _targetBoxListener: TargetBoxListener | null = null;
  private _pendingShow: { animate: boolean; onComplete?: () => void } | null = null;
  private _isDestroyed = false;

  _init(params: AuroraDashParams = {}): void {
    super._init();

    if (typeof params.monitorIndex === 'number') {
      this._monitorIndex = params.monitorIndex;
    }

    // Redirect "Show Apps" button to the overview instead of toggling
    const button = (this as any).showAppsButton;
    button?.set_toggle_mode?.(false);
    button?.connectObject?.('clicked', () => Main.overview.showApps(), this);

    // Track drag state so the dock stays visible while dragging items
    Main.overview.connectObject(
      'item-drag-begin', () => { this._draggingItem = true; this._onHover(); },
      'item-drag-end', () => { this._draggingItem = false; this._onHover(); },
      this
    );

    const dashContainer = (this as unknown as { _dashContainer?: St.Widget })._dashContainer;
    dashContainer?.set_track_hover?.(true);
    dashContainer?.set_reactive?.(true);
    dashContainer?.set_style?.(`padding: 0 ${DOCK_CONTENT_PADDING}px;`);
    dashContainer?.connectObject?.('notify::hover', this._onHover.bind(this), this);

    this.set_x_align?.(Clutter.ActorAlign.CENTER);
    this.set_y_align?.(Clutter.ActorAlign.END);
    this.set_x_expand?.(false);
    this.set_y_expand?.(false);

    this.connectObject?.('notify::allocation', () => this._queueTargetBoxUpdate(), this);
  }

  get monitorIndex(): number {
    return this._monitorIndex;
  }

  set monitorIndex(index: number) {
    if (this._monitorIndex === index) return;
    this._monitorIndex = index;
    this._workArea = null;
  }

  get targetBox(): DashBounds | null {
    return this._targetBox;
  }

  override destroy(): void {
    if (this._isDestroyed) return;
    this._isDestroyed = true;

    this._clearAllTimeouts();

    (this as any).showAppsButton?.disconnectObject?.(this);
    this.disconnectObject?.(this);
    Main.overview.disconnectObject(this);
    (this as any)._dashContainer?.disconnectObject?.(this);
    this._container?.disconnectObject?.(this);

    this._container = null;
    this._targetBox = null;
    this._pendingShow = null;

    super.destroy();
  }

  override _queueRedisplay(): void {
    if (this._isDestroyed) return;
    super._queueRedisplay();
  }

  /** Force the dash to re-render its icon list. */
  refresh(): void {
    const dash = this as unknown as { _redisplay?: () => void; _queueRedisplay?: () => void };
    if (typeof dash._redisplay === 'function') {
      dash._redisplay();
    } else {
      dash._queueRedisplay?.();
    }
  }

  setTargetBoxListener(listener: TargetBoxListener | null): void {
    this._targetBoxListener = listener;
    listener?.(this._targetBox);
  }

  attachToContainer(container: St.Bin): void {
    if (this._container === container) return;

    this._container?.disconnectObject?.(this);
    this._container = container;

    const containerObj = container as unknown as {
      connectObject?: (signal: string, handler: () => void, scope?: object) => void;
    };

    containerObj.connectObject?.('notify::allocation', () => this._queueTargetBoxUpdate(), this);
    containerObj.connectObject?.('destroy', () => {
      if (this._container === container) this._container = null;
    }, this);

    this._queueTargetBoxUpdate();
  }

  detachFromContainer(): void {
    this._container?.disconnectObject?.(this);
    this._container = null;
    this._dashBounds = null;
    this._targetBox = null;
    this._targetBoxListener?.(null);
    this._pendingShow = null;
  }

  applyWorkArea(workArea: DashBounds): void {
    this._workArea = workArea;
    if (!this._container) return;

    const [, prefW] = this.get_preferred_width(workArea.width);
    const width = Math.min(Math.max(prefW, 0), workArea.width);

    const [, prefH] = this.get_preferred_height(width || workArea.width);
    const height = Math.min(Math.max(prefH, 0), workArea.height);

    const marginBottom = this._getMarginBottom();
    const x = workArea.x + Math.round((workArea.width - width) / 2);
    const y = Math.max(workArea.y, workArea.y + workArea.height - height - marginBottom);

    this._container.set_size(width, height);
    this._container.set_position(x, y);
    this._queueTargetBoxUpdate();
  }

  blockAutoHide(block: boolean): void {
    this._blockAutoHide = block;
    if (block && !Main.overview.visible) {
      this.show(true);
    } else if (!block) {
      this._ensureHoverState();
    }
    this._onHover();
  }

  /** Schedule a delayed hover re-evaluation after visibility changes. */
  ensureAutoHide(): void {
    this._clearTimeout('_delayEnsureAutoHideId');
    this._delayEnsureAutoHideId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      VISIBILITY_ANIMATION_TIME,
      () => {
        this._onHover();
        this._delayEnsureAutoHideId = 0;
        return GLib.SOURCE_REMOVE;
      }
    );
  }

  override show(animate = true, onComplete?: () => void): void {
    if (!this._hasValidAllocation()) {
      this._pendingShow = { animate, onComplete };
      return;
    }
    this._pendingShow = null;
    this._performShow(animate, onComplete);
  }

  override hide(animate = true): void {
    if (this._isFullyHidden()) return;

    this.remove_all_transitions();
    this.set_pivot_point(0.5, 1);

    if (!animate) {
      this.translation_y = this.height;
      this.opacity = 0;
      this.set_scale(HIDE_SCALE, HIDE_SCALE);
      super.hide();
      return;
    }

    this.ease({
      opacity: 0,
      scale_x: HIDE_SCALE,
      scale_y: HIDE_SCALE,
      duration: VISIBILITY_ANIMATION_TIME * EASE_DURATION_FACTOR,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      onComplete: () => super.hide(),
    });

    this.ease_property('translation-y', this.height, {
      duration: VISIBILITY_ANIMATION_TIME,
      mode: Clutter.AnimationMode.LINEAR,
    });
  }

  // -- Private helpers --

  private _performShow(animate = true, onComplete?: () => void): void {
    if (this._isFullyShown()) {
      onComplete?.();
      return;
    }

    super.show();
    this._correctYPosition();
    this.remove_all_transitions();
    this.set_pivot_point(0.5, 1);

    if (!animate) {
      this.translation_y = 0;
      this.opacity = 255;
      this.set_scale(1, 1);
      onComplete?.();
      return;
    }

    this.ease({
      opacity: 255,
      scale_x: 1,
      scale_y: 1,
      duration: VISIBILITY_ANIMATION_TIME,
      mode: Clutter.AnimationMode.EASE_IN_CUBIC,
      onComplete,
    });

    this.ease_property('translation-y', 0, {
      duration: VISIBILITY_ANIMATION_TIME * EASE_DURATION_FACTOR,
      mode: Clutter.AnimationMode.LINEAR,
    });
  }

  /**
   * Override Dash._redisplay to resize the container after icon list changes.
   * If iconSize changed, animate icons to the new size (applyWorkArea runs
   * after animation). Otherwise, re-apply the work area immediately so the
   * container grows/shrinks to fit added or removed icons.
   */
  private _redisplay(): void {
    const dashAny = this as any;
    const oldIconSize = dashAny.iconSize;
    Dash.prototype._redisplay.call(this);
    if (dashAny.iconSize !== oldIconSize) {
      this._animateIconResize();
    } else if (this._workArea) {
      this.applyWorkArea(this._workArea);
    }
  }

  /**
   * Animate all dock icons to the current icon size after a size change.
   * Re-applies the work area once all animations finish to resize the
   * container to the final preferred width — NOT per-frame, to avoid a
   * feedback loop where a shrinking container triggers further shrinking.
   */
  private _animateIconResize(): void {
    if (!this._workArea) return;

    const dashAny = this as any;
    const iconChildren = dashAny._box
      ?.get_children?.()
      ?.filter((actor: any) => actor.child?._delegate?.icon && !actor.animatingOut) ?? [];

    if (dashAny._showAppsIcon) {
      iconChildren.push(dashAny._showAppsIcon);
    }

    const isVisible = this.visible && this.opacity > 0;
    let pendingAnimations = 0;

    const onAnimationDone = () => {
      pendingAnimations--;
      if (pendingAnimations === 0 && this._workArea) {
        this.applyWorkArea(this._workArea);
      }
    };

    for (const child of iconChildren) {
      const icon = child.child._delegate.icon;
      icon.setIconSize(dashAny.iconSize);
      const [targetWidth, targetHeight] = icon.icon.get_size();

      if (!isVisible) {
        icon.icon.set_size(targetWidth, targetHeight);
        continue;
      }

      pendingAnimations++;
      icon.icon.ease({
        width: targetWidth,
        height: targetHeight,
        duration: ANIMATION_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: onAnimationDone,
      });
    }

    dashAny._separator?.ease({
      height: dashAny.iconSize,
      duration: ANIMATION_TIME,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });

    // If nothing animated (dock not visible), apply work area immediately
    if (pendingAnimations === 0 && this._workArea) {
      this.applyWorkArea(this._workArea);
    }
  }

  /** Start or restart the autohide timeout — hides the dock if not hovered/dragging/blocked. */
  private _onHover(): void {
    this._clearTimeout('_autohideTimeoutId');
    this._autohideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTOHIDE_TIMEOUT, () => {
      const dashContainer = (this as any)._dashContainer as St.Widget | undefined;
      if (dashContainer?.get_hover?.() || this._draggingItem || this._blockAutoHide) {
        return GLib.SOURCE_CONTINUE;
      }
      this.hide(true);
      this._autohideTimeoutId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  /** If the cursor is still over the dash container, ensure the dock stays shown. */
  private _ensureHoverState(): void {
    this._clearTimeout('_blockAutoHideDelayId');
    this._blockAutoHideDelayId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      const dashContainer = (this as any)._dashContainer as St.Widget | undefined;
      if (dashContainer?.get_hover?.()) this.show(false);
      this._blockAutoHideDelayId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  private _isFullyShown(): boolean {
    return this.visible
      && this.translation_y === 0
      && this.scale_x === 1
      && this.scale_y === 1
      && this.opacity === 255;
  }

  private _isFullyHidden(): boolean {
    return !this.visible
      && this.translation_y === this.height
      && this.scale_x === HIDE_SCALE
      && this.scale_y === HIDE_SCALE
      && this.opacity === 0;
  }

  /** Correct dock Y position if it drifts from the work area bottom edge. */
  private _correctYPosition(): void {
    if (!this._workArea || !this._dashBounds) return;

    const dockBottom = this._dashBounds.y + this._dashBounds.height;
    const workAreaBottom = this._workArea.y + this._workArea.height;
    if (dockBottom !== workAreaBottom) {
      this.y += workAreaBottom - dockBottom;
    }
  }

  /** Read the allocation box and return `{ width, height }`, or null if empty/missing. */
  private _getAllocationSize(): { width: number; height: number } | null {
    const alloc = this.get_allocation_box?.();
    if (!alloc) return null;

    const width = Math.max(0, (alloc.x2 ?? 0) - (alloc.x1 ?? 0));
    const height = Math.max(0, (alloc.y2 ?? 0) - (alloc.y1 ?? 0));
    return (width > 0 && height > 0) ? { width, height } : null;
  }

  private _hasValidAllocation(): boolean {
    return this._getAllocationSize() !== null;
  }

  private _queueTargetBoxUpdate(): void {
    if (!this._container) return;

    const size = this._getAllocationSize();
    if (!size) return;

    const [stageX, stageY] = (this as any).get_transformed_position?.() ?? [0, 0];

    const dashBounds: DashBounds = { x: stageX, y: stageY, ...size };
    this._dashBounds = dashBounds;

    const padded: DashBounds = {
      x: dashBounds.x - TARGET_BOX_PADDING,
      y: dashBounds.y - TARGET_BOX_PADDING,
      width: dashBounds.width + TARGET_BOX_PADDING * 2,
      height: dashBounds.height + TARGET_BOX_PADDING * 2,
    };

    if (!boundsEqual(this._targetBox, padded)) {
      this._targetBox = padded;
      this._targetBoxListener?.(this._targetBox);
    }

    this._flushPendingShow();
  }

  private _flushPendingShow(): void {
    if (!this._pendingShow || !this._hasValidAllocation()) return;

    const { animate, onComplete } = this._pendingShow;
    this._pendingShow = null;
    this._performShow(animate, onComplete);
  }

  private _getMarginBottom(): number {
    try {
      return (this as unknown as St.Widget).get_theme_node().get_length('margin-bottom');
    } catch {
      return 0;
    }
  }

  private _clearTimeout(prop: '_autohideTimeoutId' | '_delayEnsureAutoHideId' | '_blockAutoHideDelayId'): void {
    if (this[prop]) {
      GLib.source_remove(this[prop]);
      this[prop] = 0;
    }
  }

  private _clearAllTimeouts(): void {
    this._clearTimeout('_autohideTimeoutId');
    this._clearTimeout('_delayEnsureAutoHideId');
    this._clearTimeout('_blockAutoHideDelayId');
  }
}

function boundsEqual(a: DashBounds | null, b: DashBounds | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
