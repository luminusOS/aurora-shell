// @ts-nocheck
import '@girs/gjs';
import GLib from '@girs/glib-2.0';
import Clutter from '@girs/clutter-17';
import GObject from '@girs/gobject-2.0';
import type St from '@girs/st-17';
import * as Main from '@girs/gnome-shell/ui/main';
import * as DND from '@girs/gnome-shell/ui/dnd';
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
type TimeoutProp = '_autohideTimeoutId' | '_delayEnsureAutoHideId' | '_blockAutoHideDelayId' | '_workAreaUpdateId';

const AUTOHIDE_TIMEOUT = 100;
const ANIMATION_TIME = 200;
const VISIBILITY_ANIMATION_TIME = 200;
const HIDE_SCALE = 0.98;
const EASE_DURATION_FACTOR = 0.8;
const FULL_OPACITY = 255;
const CLEAR_PLACEHOLDER_DELAY = 60;
const PIVOT_CENTER_BOTTOM: [number, number] = [0.5, 1];

interface AuroraDashParams {
  monitorIndex?: number;
}

/**
 * Custom Dash widget for Aurora Shell.
 *
 * Extends the default GNOME Shell Dash with autohide behavior, slide-in/out
 * animations, intellihide target-box tracking, and per-monitor positioning.
 *
 * Positioning model:
 * - The **container** (St.Bin, managed by Dock) is positioned at screen
 *   coordinates via `applyWorkArea → container.set_position()`.
 * - The **dash** (this widget) always sits at local y=0 inside the container.
 *   Show/hide animations use `translation_y` only — never modify `this.y`.
 */
@GObject.registerClass
export class AuroraDash extends Dash {
  private declare _monitorIndex: number;
  private _workArea: DashBounds | null = null;
  private _container: St.Bin | null = null;
  private _autohideTimeoutId = 0;
  private _delayEnsureAutoHideId = 0;
  private _blockAutoHideDelayId = 0;
  private _workAreaUpdateId = 0;
  private _targetBox: DashBounds | null = null;
  private _blockAutoHide = false;
  private _draggingItem = false;
  private _dndMonitor: { dragMotion: (e: any) => any; dragDrop: (e: any) => any } | null = null;
  private _clearPlaceholderTimerId = 0;
  /** Stage-X of _box, frozen while a placeholder exists so slot math stays consistent across frames. */
  private _dndBoxOriginX = 0;
  private _dndDropHandled = false;
  private _savedDndSource: any = null;
  private _isDestroyed = false;
  private _targetBoxListener: TargetBoxListener | null = null;
  private _pendingShow: { animate: boolean; onComplete?: () => void } | null = null;

  _init(params: AuroraDashParams = {}): void {
    super._init();

    this._monitorIndex = params.monitorIndex ?? Main.layoutManager.primaryIndex;

    // Redirect "Show Apps" button to the overview instead of toggling
    const button = (this as any).showAppsButton;
    button?.set_toggle_mode?.(false);
    button?.connectObject?.('clicked', () => Main.overview.showApps(), this);

    // Track drag state so the dock stays visible while dragging items.
    // Also install a dock-specific drag monitor to bridge the DnD gap: GNOME's
    // dnd.js finds drop targets by traversing the drag actor's parent chain,
    // which ends at Main.uiGroup and never reaches the dock's _box._delegate.
    // The drag monitor calls handleDragOver/acceptDrop directly instead.
    Main.overview.connectObject(
      'item-drag-begin', (_ov: any, source: any) => {
        this._draggingItem = true;
        this._dndDropHandled = false;
        this._onHover();
        this._setupDnd(source);
      },
      'item-drag-end', () => {
        this._draggingItem = false;
        this._onHover();
        this._teardownDnd();
      },
      'item-drag-cancelled', () => {
        this._draggingItem = false;
        this._onHover();
        this._teardownDnd();
      },
      this
    );

    const dashContainer = (this as unknown as { _dashContainer?: St.Widget })._dashContainer;
    dashContainer?.set_track_hover?.(true);
    dashContainer?.set_reactive?.(true);
    dashContainer?.connectObject?.('notify::hover', this._onHover.bind(this), this);

    this.set_x_align?.(Clutter.ActorAlign.CENTER);
    this.set_y_align?.(Clutter.ActorAlign.END);
    this.set_x_expand?.(false);
    this.set_y_expand?.(false);

    this.connectObject?.('notify::allocation', () => this._queueTargetBoxUpdate(), this);

    // Re-evaluate per-monitor app filtering when windows move between monitors
    global.display.connectObject(
      'window-entered-monitor', () => this._queueRedisplay(),
      'window-left-monitor', () => this._queueRedisplay(),
      this
    );

    // Re-evaluate when the active workspace changes
    global.workspace_manager.connectObject(
      'active-workspace-changed', () => this._queueRedisplay(),
      this
    );
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
    this._isDestroyed = true;
    this._clearAllTimeouts();

    // Remove the parent Dash's drag monitor if a DnD session is in progress.
    // Without this, dnd.js continues firing callbacks into the disposed object.
    const dragMonitor = (this as any)._dragMonitor;
    if (dragMonitor) DND.removeDragMonitor(dragMonitor);

    if (this._dndMonitor) DND.removeDragMonitor(this._dndMonitor);
    this._dndMonitor = null;
    if (this._clearPlaceholderTimerId) {
      GLib.source_remove(this._clearPlaceholderTimerId);
      this._clearPlaceholderTimerId = 0;
    }
    this._savedDndSource = null;
    this._restoreClearDragPlaceholder();

    (this as any).showAppsButton?.disconnectObject?.(this);
    this.disconnectObject?.(this);
    Main.overview.disconnectObject(this);
    global.display.disconnectObject(this);
    global.workspace_manager.disconnectObject(this);
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
    (this as any)._redisplay();
  }

  setTargetBoxListener(listener: TargetBoxListener | null): void {
    this._targetBoxListener = listener;
    listener?.(this._targetBox);
  }

  attachToContainer(container: St.Bin): void {
    if (this._container === container) return;

    this._container?.disconnectObject?.(this);
    this._container = container;

    (container as any).connectObject?.(
      'notify::allocation', () => this._queueTargetBoxUpdate(),
      'destroy', () => {
        if (this._container === container) this._container = null;
      },
      this
    );

    this._queueTargetBoxUpdate();
  }

  detachFromContainer(): void {
    this._container?.disconnectObject?.(this);
    this._container = null;
    this._targetBox = null;
    this._targetBoxListener?.(null);
    this._pendingShow = null;
  }

  applyWorkArea(workArea: DashBounds): void {
    this._workArea = workArea;
    if (this._draggingItem) return;
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
    this.set_pivot_point(...PIVOT_CENTER_BOTTOM);

    if (!animate) {
      this._applyHiddenState();
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

  private _isMenuOpen(): boolean {
    const dashAny = this as any;
    const children = dashAny._box?.get_children?.() ?? [];

    for (const child of children) {
      const appIcon = child.child?._delegate;

      if (appIcon?._menu?.isOpen) {
        return true;
      }
    }

    const showApps = dashAny.showAppsButton || dashAny._showAppsIcon?._delegate;
    if (showApps?._menu?.isOpen) {
      return true;
    }

    return false;
  }

  private _performShow(animate = true, onComplete?: () => void): void {
    if (this._isFullyShown()) {
      onComplete?.();
      return;
    }

    // Recalculate the container size to account for icon changes that
    // occurred while the dock was hidden (e.g. apps opened/closed during
    // IntelliHide BLOCKED state). Without this, the container can retain
    // a stale width and clip the last icons or overlap the show-apps button.
    if (this._workArea) {
      this.applyWorkArea(this._workArea);
    }

    // Reset all transforms BEFORE making visible so Clutter never sees the
    // actor at a stale position (avoids "needs an allocation" warnings and
    // prevents _queueTargetBoxUpdate from reading a wrong transformed Y).
    this.remove_all_transitions();
    this.set_pivot_point(...PIVOT_CENTER_BOTTOM);

    if (!animate) {
      this._applyShownState();
      super.show();
      onComplete?.();
      return;
    }

    // Start from the hidden pose, then animate in
    this._applyHiddenState();
    super.show();

    this.ease({
      opacity: FULL_OPACITY,
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

  /** Set transform properties to the fully-visible resting state. */
  private _applyShownState(): void {
    this.translation_y = 0;
    this.opacity = FULL_OPACITY;
    this.set_scale(1, 1);
  }

  /** Set transform properties to the fully-hidden state. */
  private _applyHiddenState(): void {
    this.translation_y = this.height;
    this.opacity = 0;
    this.set_scale(HIDE_SCALE, HIDE_SCALE);
  }

  // Dash._init() connects these via bare connect() (not connectObject), so they keep firing after
  // destroy(). Guard them so signals don't reach a disposed object.

  override _onItemDragBegin(): void {
    if (this._isDestroyed) return;
    (Dash.prototype as any)._onItemDragBegin?.call(this);
  }

  override _onItemDragEnd(): void {
    if (this._isDestroyed) return;
    (Dash.prototype as any)._onItemDragEnd?.call(this);
  }

  override _onItemDragCancelled(): void {
    if (this._isDestroyed) return;
    (Dash.prototype as any)._onItemDragCancelled?.call(this);
  }

  override _onWindowDragBegin(...args: any[]): void {
    if (this._isDestroyed) return;
    (Dash.prototype as any)._onWindowDragBegin?.call(this, ...args);
  }

  override _onWindowDragEnd(...args: any[]): void {
    if (this._isDestroyed) return;
    (Dash.prototype as any)._onWindowDragEnd?.call(this, ...args);
  }

  /**
   * Guard acceptDrop so we can detect when the normal actor-traversal path
   * succeeds (overview context). `_dndDropHandled` is set here so a
   * drag-monitor drop doesn't reorder twice.
   */
  override acceptDrop(...args: any[]): boolean {
    if (this._isDestroyed) return false;
    const result = (Dash.prototype as any).acceptDrop?.call(this, ...args) ?? false;
    if (result) this._dndDropHandled = true;
    return result;
  }

  /**
   * Override Dash._redisplay to resize the container after icon list changes.
   * If iconSize changed, animate icons to the new size (applyWorkArea runs
   * after animation). Otherwise, re-apply the work area immediately so the
   * container grows/shrinks to fit added or removed icons.
   */
  override _redisplay(): void {
    if (this._isDestroyed) return;
    const dashAny = this as any;
    const oldIconSize = dashAny.iconSize;

    // Temporarily patch get_running() so the base Dash only sees apps with
    // windows on this monitor and active workspace. Non-favorite running apps
    // from other monitors or workspaces will not appear in this dock.
    const appSystem = dashAny._appSystem;
    const origGetRunning = appSystem?.get_running;
    if (appSystem && origGetRunning) {
      const isRelevant = (w: any) => this._isWindowRelevant(w);
      appSystem.get_running = function () {
        return origGetRunning.call(this).filter((app: any) =>
          app.get_windows().some(isRelevant)
        );
      };
      try {
        Dash.prototype._redisplay.call(this);
      } finally {
        appSystem.get_running = origGetRunning;
      }
    } else {
      Dash.prototype._redisplay.call(this);
    }

    // Update running-indicator dots for favorites: hide the dot when the
    // app has no windows on this monitor even if the app is globally running.
    this._updatePerMonitorRunningDots();

    // Patch icon activation so clicking an app with multiple windows on
    // this monitor raises all of them instead of only the most recent one.
    this._overrideIconActivation();

    if (dashAny.iconSize !== oldIconSize) {
      this._animateIconResize();
    } else if (this._workArea && !this._draggingItem) {
      // Defer the work-area resize so newly-added icon containers have
      // completed their initial layout pass and report accurate preferred
      // sizes. Without this, the container can be sized too small and the
      // last icon gets clipped.
      this._queueWorkAreaUpdate();
    }
  }

  /**
   * Check whether a window belongs to this dock's monitor and the active
   * workspace. Windows stuck to all workspaces are always considered relevant.
   */
  private _isWindowRelevant(w: any): boolean {
    return w.get_monitor() === this._monitorIndex
      && (w.is_on_all_workspaces?.()
        || w.get_workspace() === global.workspace_manager.get_active_workspace());
  }

  /**
   * Show the running-indicator dot only for apps that have at least one
   * window on this dash's monitor and active workspace. This ensures
   * favorites pinned across all docks only display activity where the
   * app is actually open.
   */
  private _updatePerMonitorRunningDots(): void {
    const children = (this as any)._box?.get_children?.() ?? [];
    for (const child of children) {
      const icon = child.child?._delegate;
      if (!icon?.app) continue;

      const hasWindowHere = icon.app.get_windows().some(
        (w: any) => this._isWindowRelevant(w)
      );

      const dot = icon._dot;
      if (dot) {
        dot.visible = hasWindowHere;
      }
    }
  }

  /**
   * Override app icon activation so clicking an app with multiple windows
   * on this monitor and active workspace cycles through them in MRU
   * (Most Recently Used) order. A snapshot of the MRU list is taken on the
   * first click and reused for subsequent clicks so the order stays stable
   * while cycling. The snapshot resets automatically when the focused
   * window no longer matches the last cycled-to window (e.g. the user
   * clicked a window directly or switched apps).
   */
  private _overrideIconActivation(): void {
    const children = (this as any)._box?.get_children?.() ?? [];
    for (const child of children) {
      const appIcon = child.child?._delegate;
      if (!appIcon?.app || appIcon._auroraActivatePatched) continue;

      appIcon._auroraActivatePatched = true;
      const originalActivate = appIcon.activate.bind(appIcon);
      const isRelevant = (w: any) => this._isWindowRelevant(w);

      appIcon.activate = function (button: number) {
        // `this` is appIcon here — _cycleState is stored per icon, not on AuroraDash.
        // Ctrl+click or middle-click opens a new window — keep default behavior
        const event = Clutter.get_current_event();
        const modifiers = event ? event.get_state() : 0;
        const isMiddleButton = button && button === Clutter.BUTTON_MIDDLE;
        const isCtrlPressed = (modifiers & Clutter.ModifierType.CONTROL_MASK) !== 0;

        if (isCtrlPressed || isMiddleButton) {
          this._cycleState = null;
          originalActivate(button);
          return;
        }

        const windows = appIcon.app.get_windows().filter(isRelevant);

        if (windows.length <= 1) {
          this._cycleState = null;
          originalActivate(button);
          return;
        }

        const focusedWindow = global.display.focus_window;
        const isFocused = windows.some((w: any) => w === focusedWindow);
        const appId = appIcon.app.get_id();

        if (!isFocused) {
          // App not focused: activate the most recently used window
          this._cycleState = null;
          const win = windows[0];
          if (win.minimized) win.unminimize();
          Main.activateWindow(win);
          return;
        }

        // Check if we can continue an existing MRU cycle: the focused
        // window must match the last window we cycled to.
        if (
          this._cycleState?.appId === appId &&
          this._cycleState.windows[this._cycleState.index] === focusedWindow
        ) {
          // Advance to the next window in the snapshot
          const nextIndex = (this._cycleState.index + 1) % this._cycleState.windows.length;
          const next = this._cycleState.windows[nextIndex];

          // Validate the window still exists on this monitor/workspace
          if (windows.some((w: any) => w === next)) {
            this._cycleState.index = nextIndex;
            if (next.minimized) next.unminimize();
            Main.activateWindow(next);
            return;
          }
          // Window was closed — fall through to start a fresh cycle
        }

        // Start a new MRU cycle: snapshot the current order and activate
        // the second entry (the first is the already-focused window).
        this._cycleState = { appId, windows: [...windows], index: 1 };
        const next = windows[1];
        if (next.minimized) next.unminimize();
        Main.activateWindow(next);
      };
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
      if (this._isDestroyed) return;
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
    if (this._isDestroyed) return;
    this._clearTimeout('_autohideTimeoutId');
    this._autohideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTOHIDE_TIMEOUT, () => {
      const dashContainer = (this as any)._dashContainer as St.Widget | undefined;

      if (dashContainer?.get_hover?.() || this._draggingItem || this._blockAutoHide || this._isMenuOpen()) {
        return GLib.SOURCE_CONTINUE;
      }

      this.hide(true);
      this._autohideTimeoutId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  /** If the cursor is still over the dash container, ensure the dock stays shown. */
  private _ensureHoverState(): void {
    if (this._isDestroyed) return;
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
      && this.opacity === FULL_OPACITY;
  }

  private _isFullyHidden(): boolean {
    return !this.visible
      && this.opacity === 0;
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

  /**
   * Compute the dash bounds in stage coordinates and notify the intellihide
   * listener. Only reads `get_transformed_position` when the dash is visible
   * with no active translation, so the result reflects the true resting
   * position rather than a mid-animation snapshot.
   */
  private _queueTargetBoxUpdate(): void {
    if (!this._container) return;

    const size = this._getAllocationSize();
    if (!size) return;

    // Only compute stage position when transforms are at rest to avoid
    // capturing a mid-animation Y that would cause intellihide to track
    // a wrong position.
    if (!this.visible || this.translation_y !== 0) return;

    const [stageX, stageY] = (this as any).get_transformed_position?.() ?? [0, 0];
    const p = TARGET_BOX_PADDING;

    const padded: DashBounds = {
      x: stageX - p,
      y: stageY - p,
      width: size.width + p * 2,
      height: size.height + p * 2,
    };

    if (!AuroraDash._boundsEqual(this._targetBox, padded)) {
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

  /** Coalesce work-area resizes into a single deferred update. */
  private _queueWorkAreaUpdate(): void {
    if (this._isDestroyed || this._workAreaUpdateId) return;
    this._workAreaUpdateId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._workAreaUpdateId = 0;
      if (this._workArea) {
        this.applyWorkArea(this._workArea);
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  /**
   * Install a drag monitor and pre-expand the container for one drag session.
   *
   * ## Stable slot calculation
   * We track `_dndBoxOriginX` = the stage-X of `_box`. While no placeholder
   * exists the origin is refreshed every dragMotion frame (the box is stable).
   * The origin `_dndBoxOriginX` is frozen at the pre-drag value of `_box`'s
   * stage-X while a placeholder exists, and refreshed per-frame when the box
   * is stable (no placeholder). This works because `handleDragOver` always
   * subtracts `placeholder.width` from `boxWidth`, making:
   *   boxWidth_adj = _box.width − placeholder.width = origBoxW
   * so `pos = floor((event.x − _dndBoxOriginX) × N / origBoxW)` is identical
   * in all frames — no analytical correction is needed.
   *
   * On first placeholder insertion we cancel its fade-in animation immediately
   * so the layout settles in a single frame.
   */
  private _setupDnd(_source: any): void {
    if (this._dndMonitor) return;

    this._savedDndSource = null;
    this._dndDropHandled = false;

    // Capture initial origin and pre-expand the container.
    const box = (this as any)._box;
    this._dndBoxOriginX = (box?.get_transformed_position?.() ?? [0])[0];
    this._preExpandContainer();
    this._patchClearDragPlaceholder();

    this._dndMonitor = {
      dragMotion: (event: any) => this._dndDragMotion(event),
      dragDrop: (event: any) => this._dndDragDrop(event),
    };
    DND.addDragMonitor(this._dndMonitor);
  }

  private _teardownDnd(): void {
    if (this._dndMonitor) {
      DND.removeDragMonitor(this._dndMonitor);
      this._dndMonitor = null;
    }
    this._cancelClearPlaceholderTimer();
    this._restoreClearDragPlaceholder();
    this._savedDndSource = null;
    this._dndDropHandled = false;
    if (this._workArea) this.applyWorkArea(this._workArea);
  }

  private _dndDragMotion(event: any): any {
    if (this._isDestroyed) return DND.DragMotionResult.CONTINUE;

    const container = this._container;
    const box = (this as any)._box;
    if (!container || !box) return DND.DragMotionResult.CONTINUE;

    // Bounds check against the pre-expanded, position-stable container.
    const [ok, contLocalX, contLocalY] = (container as any).transform_stage_point(event.x, event.y);
    if (!ok) return DND.DragMotionResult.CONTINUE;

    const [contW, contH] = (container as any).get_size();
    if (contLocalX < 0 || contLocalX > contW || contLocalY < 0 || contLocalY > contH) {
      this._scheduleClearPlaceholder();
      return DND.DragMotionResult.CONTINUE;
    }

    this._cancelClearPlaceholderTimer();

    // Refresh _box origin only while no placeholder exists (box is stable).
    // While a placeholder is present, `handleDragOver` self-normalizes:
    // boxWidth_adj = _box.width − placeholder.width = origBoxW, so the frozen
    // origin keeps pos consistent across all frames without any correction.
    const dashAny = this as any;
    if (!dashAny._dragPlaceholder) {
      this._dndBoxOriginX = (box.get_transformed_position?.() ?? [0])[0];
    }

    const hadPlaceholder = dashAny._dragPlaceholder !== null;
    const localX = event.x - this._dndBoxOriginX;

    const result =
      (Dash.prototype as any).handleDragOver?.call(this, event.source, event.dragActor, localX, contLocalY, 0) ??
      DND.DragMotionResult.CONTINUE;

    // On first insertion: cancel fade-in animation so the layout settles
    // immediately in a single frame rather than over ~200 ms.
    if (!hadPlaceholder && dashAny._dragPlaceholder?.child) {
      dashAny._dragPlaceholder.child.remove_all_transitions?.();
      dashAny._dragPlaceholder.child.set_width(dashAny.iconSize);
    }

    if (result === DND.DragMotionResult.MOVE_DROP) {
      this._savedDndSource = event.source;
    }

    return result;
  }

  /**
   * On drop: patch targetActor._delegate so dnd.js actor-traversal reaches
   * our acceptDrop. Returning CONTINUE lets dnd.js perform its own cleanup
   * (removes drag actor, emits drag-end, restores cursor).
   */
  private _dndDragDrop(event: any): any {
    if (this._isDestroyed) return DND.DragDropResult.CONTINUE;

    const container = this._container;
    if (!container || !this._savedDndSource) return DND.DragDropResult.CONTINUE;

    const [cx, cy] = event.clutterEvent?.get_coords?.() ?? [0, 0];
    const [ok, localX, localY] = (container as any).transform_stage_point(cx, cy);
    if (!ok) return DND.DragDropResult.CONTINUE;

    const [cW, cH] = (container as any).get_size();
    if (localX < 0 || localX > cW || localY < 0 || localY > cH) return DND.DragDropResult.CONTINUE;

    const targetActor = event.targetActor;
    if (targetActor) {
      const origDelegate = targetActor._delegate;
      targetActor._delegate = {
        acceptDrop: (source: any, actor: any, x: number, y: number, time: number) => {
          targetActor._delegate = origDelegate;
          const accepted = (Dash.prototype as any).acceptDrop?.call(this, source, actor, x, y, time) ?? false;
          if (accepted) this._dndDropHandled = true;
          return accepted;
        },
      };
    }

    return DND.DragDropResult.CONTINUE;
  }

  /** Pre-expand the container by one icon-slot width before the drag monitor activates. */
  private _preExpandContainer(): void {
    if (!this._container || !this._workArea) return;

    const dashAny = this as any;
    const firstChild = (dashAny._box?.get_children?.() ?? [])[0];
    const slotWidth =
      Math.ceil((firstChild?.get_size?.() ?? [0, 0])[0]) ||
      (dashAny.iconSize ?? 48) + 24;

    const wa = this._workArea;
    const [, prefW] = this.get_preferred_width(wa.width);
    const curW = Math.min(Math.max(prefW, 0), wa.width);
    const expandedW = Math.min(curW + slotWidth, wa.width);
    const expandedX = wa.x + Math.round((wa.width - expandedW) / 2);
    const [, prefH] = this.get_preferred_height(expandedW);
    const expandedH = Math.min(Math.max(prefH, 0), wa.height);
    const marginBottom = this._getMarginBottom();
    const expandedY = Math.max(wa.y, wa.y + wa.height - expandedH - marginBottom);

    this._container.set_size(expandedW, expandedH);
    this._container.set_position(expandedX, expandedY);
  }

  /**
   * Replace `_clearDragPlaceholder` on the instance to destroy the placeholder
   * immediately (no animate-out). This keeps `_animatingPlaceholdersCount` at 0
   * so `handleDragOver` never enters its ~200 ms locked state.
   */
  private _patchClearDragPlaceholder(): void {
    const dashAny = this as any;
    dashAny._clearDragPlaceholder = () => {
      if (dashAny._dragPlaceholder) {
        dashAny._dragPlaceholder.remove_all_transitions?.();
        dashAny._dragPlaceholder.child?.remove_all_transitions?.();
        dashAny._dragPlaceholder.destroy();
        dashAny._dragPlaceholder = null;
      }
      dashAny._dragPlaceholderPos = -1;
    };
  }

  private _restoreClearDragPlaceholder(): void {
    delete (this as any)._clearDragPlaceholder;
  }

  private _scheduleClearPlaceholder(): void {
    if (this._clearPlaceholderTimerId) return;
    this._clearPlaceholderTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CLEAR_PLACEHOLDER_DELAY, () => {
      this._clearPlaceholderTimerId = 0;
      if (!this._isDestroyed) (this as any)._clearDragPlaceholder?.();
      return GLib.SOURCE_REMOVE;
    });
  }

  private _cancelClearPlaceholderTimer(): void {
    if (this._clearPlaceholderTimerId) {
      GLib.source_remove(this._clearPlaceholderTimerId);
      this._clearPlaceholderTimerId = 0;
    }
  }

  private _clearTimeout(prop: TimeoutProp): void {
    if (this[prop]) {
      GLib.source_remove(this[prop]);
      this[prop] = 0;
    }
  }

  private _clearAllTimeouts(): void {
    this._clearTimeout('_autohideTimeoutId');
    this._clearTimeout('_delayEnsureAutoHideId');
    this._clearTimeout('_blockAutoHideDelayId');
    this._clearTimeout('_workAreaUpdateId');
  }

  private static _boundsEqual(a: DashBounds | null, b: DashBounds | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }
}
