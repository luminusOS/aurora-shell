import '@girs/gjs';
import GLib from '@girs/glib-2.0';
import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import Shell from '@girs/shell-18';
import type St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';
import * as DND from '@girs/gnome-shell/ui/dnd';
import { Dash } from '@girs/gnome-shell/ui/dash';

import { logger } from '~/core/logger.ts';
import { TrashIcon, type TrashIconInstance } from '~/dock/trashIcon.ts';

export interface DashBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type TargetBoxListener = (bounds: DashBounds | null) => void;

const AUTOHIDE_TIMEOUT = 100;
const SPRING_LOAD_DELAY = 400;
const ANIMATION_TIME = 200;
const VISIBILITY_ANIMATION_TIME = 200;
const HIDE_SCALE = 0.98;
const EASE_DURATION_FACTOR = 0.8;
const FULL_OPACITY = 255;
const PIVOT_CENTER_BOTTOM: [number, number] = [0.5, 1];
const LOG_PREFIX = 'DockDash';

type VisibilityTarget = 'shown' | 'hidden';

interface AuroraDashParams {
  monitorIndex?: number;
  showTrash?: boolean;
}

type DashInternals = {
  _dashContainer?: St.Widget;
  _showAppsIcon?: St.Widget;
  iconSize: number;
  _hookUpLabel(item: unknown): void;
};

@GObject.registerClass
export class AuroraDash extends Dash {
  declare private _monitorIndex: number;
  private _workArea: DashBounds | null = null;
  private _container: St.Bin | null = null;
  private _autohideTimeoutId = 0;
  private _delayEnsureAutoHideId = 0;
  private _blockAutoHideDelayId = 0;
  private _workAreaUpdateId = 0;
  private _iconResizeTimeoutId = 0;
  private _targetBox: DashBounds | null = null;
  private _blockAutoHide = false;
  private _isDestroyed = false;
  private _flushMode = false;
  private _targetBoxListener: TargetBoxListener | null = null;
  private _pendingShow: { animate: boolean } | null = null;
  declare private _visibilityTarget: VisibilityTarget;
  declare private _showCompletionCallbacks: Array<() => void>;
  private _springLoadTimerId = 0;
  private _springLoadTarget: any = null;
  private _springLoadDragMonitor: { dragMotion: (e: any) => number } | null = null;
  declare private _trashIcon: TrashIconInstance | null;

  override _init(params: AuroraDashParams = {}): void {
    super._init();

    this._visibilityTarget = this.visible ? 'shown' : 'hidden';
    this._showCompletionCallbacks = [];
    this._trashIcon = null;
    this._monitorIndex = params.monitorIndex ?? Main.layoutManager.primaryIndex;

    const button = (this as any).showAppsButton;
    button?.set_toggle_mode?.(false);
    button?.connectObject?.('clicked', () => Main.overview.showApps(), this);

    const dashContainer = this._dashInternals._dashContainer;
    dashContainer?.set_track_hover?.(true);
    dashContainer?.set_reactive?.(true);
    dashContainer?.connectObject?.('notify::hover', this._onHover.bind(this), this);

    this.set_x_align?.(Clutter.ActorAlign.CENTER);
    this.set_y_align?.(Clutter.ActorAlign.END);
    this.set_x_expand?.(false);
    this.set_y_expand?.(false);

    this.connectObject?.('notify::allocation', () => this._queueTargetBoxUpdate(), this);

    // Track _box allocation so the chrome container follows the dash's
    // preferred width every frame. Critical during drag: the placeholder
    // animates scale 0→1, so a one-shot resize would lock the container
    // at the half-scaled width.
    (this as any)._box?.connectObject?.(
      'notify::allocation',
      () => this._queueWorkAreaUpdate(),
      this,
    );

    global.display.connectObject(
      'window-entered-monitor',
      () => this._queueRedisplay(),
      'window-left-monitor',
      () => this._queueRedisplay(),
      this,
    );

    global.workspace_manager.connectObject(
      'active-workspace-changed',
      () => this._queueRedisplay(),
      this,
    );

    this._setupSpringLoadMonitor();

    if (params.showTrash) this._setupTrashIcon();
  }

  private get _dashInternals(): DashInternals {
    return this as unknown as DashInternals;
  }

  private _removeSource(id: number): 0 {
    if (id !== 0) GLib.source_remove(id);
    return 0;
  }

  private _setupTrashIcon(): void {
    const dash = this._dashInternals;
    const dashContainer = dash._dashContainer;
    if (!dashContainer) return;

    const trashIcon = new TrashIcon() as TrashIconInstance;
    this._trashIcon = trashIcon;
    trashIcon.show(false);
    trashIcon.setIconSize(dash.iconSize);
    dash._hookUpLabel(trashIcon);

    const showAppsIcon = dash._showAppsIcon;
    const showAppsIndex = showAppsIcon ? dashContainer.get_children().indexOf(showAppsIcon) : -1;
    if (showAppsIndex >= 0) {
      dashContainer.insert_child_at_index(trashIcon, showAppsIndex);
    } else {
      dashContainer.add_child(trashIcon);
    }

    this.connectObject?.('icon-size-changed', () => trashIcon.setIconSize(dash.iconSize), this);
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

  get pointerInsideDock(): boolean {
    return this._dashContainerHasHover();
  }

  containsStagePoint(x: number, y: number): boolean {
    return (
      this._boundsContainPoint(this._getActorStageBounds(this._container), x, y) ||
      this._boundsContainPoint(this._getActorStageBounds(this), x, y) ||
      this._boundsContainPoint(this._targetBox, x, y)
    );
  }

  override destroy(): void {
    this._isDestroyed = true;
    this._autohideTimeoutId = this._removeSource(this._autohideTimeoutId);
    this._delayEnsureAutoHideId = this._removeSource(this._delayEnsureAutoHideId);
    this._blockAutoHideDelayId = this._removeSource(this._blockAutoHideDelayId);
    this._workAreaUpdateId = this._removeSource(this._workAreaUpdateId);
    this._iconResizeTimeoutId = this._removeSource(this._iconResizeTimeoutId);
    this._springLoadTimerId = this._removeSource(this._springLoadTimerId);

    // Remove the global DND drag monitor so its captured `this` doesn't
    // keep firing against a disposed AuroraDash if the dash is destroyed
    // mid-drag (e.g. monitor or settings change). Stock _endItemDrag
    // removes it on drag end but never on early disposal.
    const dashAny = this as any;
    if (dashAny._dragMonitor) {
      try {
        DND.removeDragMonitor(dashAny._dragMonitor);
      } catch {
        // Already removed by base _endItemDrag — ignore.
      }
      dashAny._dragMonitor = null;
    }

    if (this._springLoadDragMonitor) {
      try {
        DND.removeDragMonitor(this._springLoadDragMonitor);
      } catch (_e) {
        /* already removed */
      }
      this._springLoadDragMonitor = null;
    }
    this._springLoadTarget = null;

    (this as any).showAppsButton?.disconnectObject?.(this);
    (this as any)._box?.disconnectObject?.(this);
    Main.overview.disconnectObject(this);
    global.display.disconnectObject(this);
    global.workspace_manager.disconnectObject(this);
    (this as any)._dashContainer?.disconnectObject?.(this);
    this._container?.disconnectObject?.(this);
    (global.backend as any).get_dnd?.()?.disconnectObject?.(this);

    this._container = null;
    this._targetBox = null;
    this._pendingShow = null;
    this._showCompletionCallbacks = [];

    super.destroy();
  }

  override _queueRedisplay(): void {
    if (this._isDestroyed) return;
    super._queueRedisplay();
  }

  refresh(): void {
    (this as any)._redisplay();
  }

  setFlushMode(flush: boolean): void {
    this._flushMode = flush;
    if (flush) {
      this.add_style_class_name('flush-mode');
    } else {
      this.remove_style_class_name('flush-mode');
    }
    this._syncLabelFlushMode();
    this.ensure_style();
    this._queueWorkAreaUpdate();
  }

  private _syncLabelFlushMode(): void {
    const items: any[] = [...this._getDashChildren(), (this as any)._showAppsIcon];
    for (const item of items) {
      try {
        if (!item?.label) continue;
        if (this._flushMode) {
          item.label.add_style_class_name('flush-mode');
        } else {
          item.label.remove_style_class_name('flush-mode');
        }
      } catch {
        // Ignore children disposed during shell shutdown.
      }
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

    (container as any).connectObject?.(
      'notify::allocation',
      () => this._queueTargetBoxUpdate(),
      'destroy',
      () => {
        if (this._container === container) this._container = null;
      },
      this,
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
    if (this._isDestroyed) return;
    this._workArea = workArea;
    if (!this._container) return;

    try {
      // Provide the dash with its maximum bounds so it can automatically
      // shrink the iconSize when there are too many apps to fit.
      this.setMaxSize(workArea.width, workArea.height);

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
    } catch (_e) {
      if (!this._isDestroyed) throw _e;
    }
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

  forceAutoHide(animate = true): void {
    this._blockAutoHide = false;

    this._blockAutoHideDelayId = this._removeSource(this._blockAutoHideDelayId);
    this._autohideTimeoutId = this._removeSource(this._autohideTimeoutId);

    this.hide(animate);
  }

  ensureAutoHide(): void {
    this._delayEnsureAutoHideId = this._removeSource(this._delayEnsureAutoHideId);
    this._delayEnsureAutoHideId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      VISIBILITY_ANIMATION_TIME,
      () => {
        this._onHover();
        this._delayEnsureAutoHideId = 0;
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  override show(animate = true, onComplete?: () => void): void {
    this._container?.show();
    this._setContainerInputEnabled(true);
    if (onComplete) this._showCompletionCallbacks.push(onComplete);

    // Monitor topology changes can emit several allocation/work-area and
    // intellihide updates for the same visible state. Restarting an active
    // show transition from the hidden pose on every update makes the dock
    // flash rapidly, especially on rotated external monitors.
    if (this._visibilityTarget === 'shown') {
      if (this._isFullyShown()) this._flushShowCompletionCallbacks();
      return;
    }

    logger.debug(
      `monitor=${this._monitorIndex} visibility ${this._visibilityTarget}->shown animate=${animate}`,
      { prefix: LOG_PREFIX },
    );
    this._visibilityTarget = 'shown';

    if (!this._hasValidAllocation()) {
      this._pendingShow = { animate };
      return;
    }
    this._pendingShow = null;
    this._performShow(animate);
  }

  override hide(animate = true): void {
    // The chrome container remains allocated while the dash is hidden. If it
    // stays reactive, its transparent bounds win Clutter picking and create a
    // dead area over controls in windows underneath the dock.
    this._setContainerInputEnabled(false);

    if (this._visibilityTarget === 'hidden') {
      if (this._isFullyHidden()) return;
      logger.debug(`monitor=${this._monitorIndex} visibility hidden resync animate=${animate}`, {
        prefix: LOG_PREFIX,
      });
    } else {
      logger.debug(
        `monitor=${this._monitorIndex} visibility ${this._visibilityTarget}->hidden animate=${animate}`,
        { prefix: LOG_PREFIX },
      );
    }
    this._visibilityTarget = 'hidden';
    this._pendingShow = null;
    this._showCompletionCallbacks = [];

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
      scaleX: HIDE_SCALE,
      scaleY: HIDE_SCALE,
      duration: VISIBILITY_ANIMATION_TIME * EASE_DURATION_FACTOR,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      onComplete: () => {
        if (this._visibilityTarget === 'hidden') {
          super.hide();
          logger.debug(`monitor=${this._monitorIndex} hidden transition completed`, {
            prefix: LOG_PREFIX,
          });
        }
      },
    });

    this.ease_property('translation-y', this.height, {
      duration: VISIBILITY_ANIMATION_TIME,
      mode: Clutter.AnimationMode.LINEAR,
    });
  }

  private _isMenuOpen(): boolean {
    const dashAny = this as any;
    const children = this._getDashChildren();

    for (const child of children) {
      let appIcon: any;
      try {
        appIcon = child.child?._delegate;
      } catch {
        continue;
      }

      if (appIcon?._menu?.isOpen) {
        return true;
      }
    }

    const showApps = dashAny.showAppsButton || dashAny._showAppsIcon?._delegate;
    if (showApps?._menu?.isOpen) {
      return true;
    }

    if (this._trashIcon?.menuIsOpen) {
      return true;
    }

    return false;
  }

  private _dashContainerHasHover(): boolean {
    try {
      const dashContainer = (this as any)._dashContainer as St.Widget | undefined;
      return dashContainer?.get_hover?.() ?? false;
    } catch {
      return false;
    }
  }

  private _performShow(animate = true): void {
    if (this._visibilityTarget !== 'shown') return;

    if (this._isFullyShown()) {
      this._flushShowCompletionCallbacks();
      return;
    }

    // Recalculate the container size to account for icon changes that
    // occurred while the dock was hidden (e.g. apps opened/closed during
    // IntelliHide BLOCKED state). Without this, the container can retain
    // a stale width and clip the last icons or overlap the show-apps button.
    if (this._workArea) {
      this.applyWorkArea(this._workArea);
    }

    const wasVisible = this.visible;
    this.remove_all_transitions();
    this.set_pivot_point(...PIVOT_CENTER_BOTTOM);

    if (!animate) {
      this._applyShownState();
      super.show();
      this._queueTargetBoxUpdate();
      this._flushShowCompletionCallbacks();
      return;
    }

    if (!wasVisible) this._applyHiddenState();
    super.show();

    this.ease({
      opacity: FULL_OPACITY,
      scaleX: 1,
      scaleY: 1,
      duration: VISIBILITY_ANIMATION_TIME,
      mode: Clutter.AnimationMode.EASE_IN_CUBIC,
      onComplete: () => {
        if (this._visibilityTarget !== 'shown') return;
        this._applyShownState();
        this._queueTargetBoxUpdate();
        logger.debug(`monitor=${this._monitorIndex} shown transition completed`, {
          prefix: LOG_PREFIX,
        });
        this._flushShowCompletionCallbacks();
      },
    });

    this.ease_property('translation-y', 0, {
      duration: VISIBILITY_ANIMATION_TIME * EASE_DURATION_FACTOR,
      mode: Clutter.AnimationMode.LINEAR,
    });
  }

  private _applyShownState(): void {
    this.translation_y = 0;
    this.opacity = FULL_OPACITY;
    this.set_scale(1, 1);
  }

  private _applyHiddenState(): void {
    this.translation_y = this.height;
    this.opacity = 0;
    this.set_scale(HIDE_SCALE, HIDE_SCALE);
  }

  private _flushShowCompletionCallbacks(): void {
    const callbacks = this._showCompletionCallbacks;
    this._showCompletionCallbacks = [];
    for (const callback of callbacks) callback();
  }

  private _setContainerInputEnabled(enabled: boolean): void {
    this._container?.set_reactive(enabled);
  }

  private _getActorStageBounds(actor: any): DashBounds | null {
    if (!actor?.visible) return null;

    const allocation = actor.get_allocation_box?.();
    if (!allocation) return null;

    const width = Math.max(0, (allocation.x2 ?? 0) - (allocation.x1 ?? 0));
    const height = Math.max(0, (allocation.y2 ?? 0) - (allocation.y1 ?? 0));
    if (width <= 0 || height <= 0) return null;

    const [x, y] = actor.get_transformed_position?.() ?? [actor.x, actor.y];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return { x, y, width, height };
  }

  private _boundsContainPoint(bounds: DashBounds | null, x: number, y: number): boolean {
    if (!bounds) return false;
    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    );
  }

  // Stock Dash._init() connects item-drag-* / window-drag-* via bare
  // connect() (no disconnect on destroy), so signals keep firing after the
  // GObject is disposed. Each override is just a disposed-guard; resize is
  // driven by the _box notify::allocation listener in _init.
  private _guardedSuper(method: string, args: any[] = []): void {
    if (this._isDestroyed) return;
    (Dash.prototype as any)[method].call(this, ...args);
  }

  override _onItemDragBegin(): void {
    this._guardedSuper('_onItemDragBegin');
  }
  override _onItemDragEnd(): void {
    this._guardedSuper('_onItemDragEnd');
  }
  override _onItemDragCancelled(): void {
    this._guardedSuper('_onItemDragCancelled');
  }
  override _onWindowDragBegin(...a: any[]): void {
    this._guardedSuper('_onWindowDragBegin', a);
  }
  override _onWindowDragEnd(...a: any[]): void {
    this._guardedSuper('_onWindowDragEnd', a);
  }

  override _syncLabel(item: any, appIcon: any): void {
    if (this._isDestroyed) return;

    if (item && !item._auroraShowLabelPatched) {
      item._auroraShowLabelPatched = true;
      const originalShowLabel = item.showLabel;
      item.showLabel = function () {
        if (!this.label) return;
        originalShowLabel.call(this);
      };
    }

    (Dash.prototype as any)._syncLabel?.call(this, item, appIcon);
  }

  override _createAppItem(app: any): any {
    const item = super._createAppItem(app);
    const dashAny = this as any;

    // Stock Dash._redisplay calls item.destroy() when removing icons. We intercept
    // to animate out ONLY when the app actually closed (not when it was filtered
    // out by the workspace/monitor check). _globallyRunningIds is set during
    // _redisplay and contains all globally running app IDs at that moment.
    const originalDestroy = item.destroy.bind(item);
    item.destroy = () => {
      const globalIds = dashAny._globallyRunningIds as Set<string> | undefined;
      const appId = (item.child as any)?._delegate?.app?.get_id?.() as string | undefined;
      const appActuallyClosed =
        globalIds !== undefined && appId !== undefined && !globalIds.has(appId);

      if (
        appActuallyClosed &&
        this.visible &&
        this.opacity > 0 &&
        !item.animatingOut &&
        !Main.overview.animationInProgress
      ) {
        item.animateOutAndDestroy();
      } else {
        originalDestroy();
      }
    };

    return item;
  }

  override _redisplay(): void {
    if (this._isDestroyed) return;
    const dashAny = this as any;
    const oldIconSize = dashAny.iconSize;
    const shouldAnimate = this.visible && this.opacity > 0;

    const isFirstDisplay = !dashAny._shownInitially;
    const existingApps = new Set<any>();
    for (const child of this._getDashChildren()) {
      try {
        const app = child.child?._delegate?.app;
        if (app && !child.animatingOut) existingApps.add(app);
      } catch {
        // Ignore children disposed during shell shutdown.
      }
    }

    // Temporarily patch get_running() so the base Dash only sees apps with
    // windows on this monitor and active workspace. _globallyRunningIds is set
    // so the _createAppItem.destroy patch can distinguish actual closes (animate
    // out) from workspace-filter removals (instant destroy, no ghost icons).
    const appSystem = dashAny._appSystem;
    const origGetRunning = appSystem?.get_running;
    if (appSystem && origGetRunning) {
      const hadOwnProp = Object.prototype.hasOwnProperty.call(appSystem, 'get_running');
      const allApps: any[] = origGetRunning.call(appSystem);
      dashAny._globallyRunningIds = new Set<string>(allApps.map((a: any) => a.get_id()));

      const isRelevant = (w: any) => this._isWindowRelevant(w);
      appSystem.get_running = () => {
        const apps = allApps.filter((app: any) => {
          if (app.get_state?.() === Shell.AppState.STARTING) return true;
          return app.get_windows().some(isRelevant);
        });

        return apps.sort((a: any, b: any) => {
          const minSeq = (app: any): number => {
            const wins: any[] = app.get_windows();
            if (wins.length === 0) return Number.MAX_SAFE_INTEGER;
            return wins.reduce(
              (m: number, w: any) => Math.min(m, (w.get_stable_sequence?.() ?? 0) as number),
              Number.MAX_SAFE_INTEGER,
            );
          };
          return minSeq(a) - minSeq(b);
        });
      };

      try {
        Dash.prototype._redisplay.call(this);
      } finally {
        if (hadOwnProp) {
          appSystem.get_running = origGetRunning;
        } else {
          delete appSystem.get_running;
        }
        delete dashAny._globallyRunningIds;
      }
    } else {
      Dash.prototype._redisplay.call(this);
    }

    if (shouldAnimate && !isFirstDisplay) {
      for (const child of this._getDashChildren()) {
        try {
          const childApp = child.child?._delegate?.app;
          if (childApp && !existingApps.has(childApp) && !child.animatingOut) {
            child.remove_all_transitions();
            child.scale_x = 0;
            child.scale_y = 0;
            child.opacity = 0;
            child.ease({
              scale_x: 1,
              scale_y: 1,
              opacity: 255,
              duration: ANIMATION_TIME,
              mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
          }
        } catch {
          // Ignore children disposed during shell shutdown.
        }
      }
    }

    this._updatePerMonitorRunningDots();
    this._syncLabelFlushMode();
    this._overrideIconActivation();

    if (dashAny.iconSize !== oldIconSize) {
      this._iconResizeTimeoutId = this._removeSource(this._iconResizeTimeoutId);
      this._iconResizeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ANIMATION_TIME, () => {
        this._iconResizeTimeoutId = 0;
        if (this._workArea) this.applyWorkArea(this._workArea);
        return GLib.SOURCE_REMOVE;
      });
    } else if (this._workArea) {
      this._queueWorkAreaUpdate();
    }
  }

  private _isWindowRelevant(w: any): boolean {
    return (
      w.get_monitor() === this._monitorIndex &&
      (w.is_on_all_workspaces?.() ||
        w.get_workspace() === global.workspace_manager.get_active_workspace())
    );
  }

  private _updatePerMonitorRunningDots(): void {
    for (const child of this._getDashChildren()) {
      try {
        const icon = child.child?._delegate;
        if (!icon?.app) continue;
        const hasWindowHere = icon.app.get_windows().some((w: any) => this._isWindowRelevant(w));
        const dot = icon._dot;
        if (dot) dot.visible = hasWindowHere;
      } catch {
        // Ignore children disposed during shell shutdown.
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
    for (const child of this._getDashChildren()) {
      let appIcon: any;
      try {
        appIcon = child.child?._delegate;
      } catch {
        continue;
      }
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

        if (windows.length === 0 && appIcon.app.get_state() === Shell.AppState.RUNNING) {
          this._cycleState = null;
          // App has windows on other monitors/workspaces — open a new window in the current workspace
          appIcon.app.open_new_window(-1);
          return;
        }

        if (windows.length <= 1) {
          this._cycleState = null;
          if (windows.length === 1) {
            // Activate the window directly to avoid DashIcon.activate() checking the
            // C-level app.state. IconWeave-mapped apps have C-level state STOPPED
            // (the process isn't natively tracked), so DashIcon.activate() would call
            // animateLaunch() and show the "opening new instance" bounce animation
            // even though we're just switching to an existing window.
            const win = windows[0];
            if (win.minimized) win.unminimize();
            Main.activateWindow(win);
          } else {
            // No windows on this monitor/workspace and app is not "running" per our
            // patched get_state() — treat as a stopped app and let the default
            // DashIcon behavior launch it.
            originalActivate(button);
          }
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

  private _getDashChildren(): any[] {
    if (this._isDestroyed) return [];
    try {
      return (this as any)._box?.get_children?.() ?? [];
    } catch {
      return [];
    }
  }

  private _setupSpringLoadMonitor(): void {
    this._springLoadDragMonitor = {
      dragMotion: (dragEvent: any) => {
        if (this._isDestroyed) return DND.DragMotionResult.CONTINUE;

        if (dragEvent.source?.app) {
          this._clearSpringLoad();
          return DND.DragMotionResult.CONTINUE;
        }

        const { x, y } = dragEvent;
        let actor: Clutter.Actor | null | undefined = global.stage.get_actor_at_pos?.(
          Clutter.PickMode.REACTIVE,
          x,
          y,
        );
        const box = (this as any)._box;
        let target: any = null;

        while (actor) {
          if (actor.get_parent?.() === box) {
            target = actor;
            break;
          }
          actor = actor.get_parent?.();
        }

        if (target !== this._springLoadTarget) {
          this._clearSpringLoad();
          this._springLoadTarget = target;

          const appIcon = target?.child?._delegate;
          if (appIcon?.app) {
            target.add_style_class_name?.('aurora-drag-hover');
            const isRelevant = (w: any) => this._isWindowRelevant(w);
            this._springLoadTimerId = GLib.timeout_add(
              GLib.PRIORITY_DEFAULT,
              SPRING_LOAD_DELAY,
              () => {
                this._springLoadTimerId = 0;
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                const windows = appIcon.app?.get_windows?.()?.filter?.(isRelevant) ?? [];
                if (windows.length > 0) {
                  const win = windows[0];
                  if (win?.minimized) win.unminimize();
                  Main.activateWindow(win);
                }
                return GLib.SOURCE_REMOVE;
              },
            );
          }
        }

        return DND.DragMotionResult.CONTINUE;
      },
    };

    DND.addDragMonitor(this._springLoadDragMonitor);

    (global.backend as any)
      .get_dnd?.()
      ?.connectObject?.('dnd-leave', () => this._clearSpringLoad(), this);
  }

  private _clearSpringLoad(): void {
    try {
      this._springLoadTarget?.remove_style_class_name?.('aurora-drag-hover');
    } catch {
      // The target may already be disposed during shell shutdown.
    }
    if (this._springLoadTimerId !== 0) {
      this._springLoadTimerId = this._removeSource(this._springLoadTimerId);
    }
    this._springLoadTarget = null;
  }

  private _onHover(): void {
    if (this._isDestroyed) return;
    if (this._autohideTimeoutId !== 0) {
      this._autohideTimeoutId = this._removeSource(this._autohideTimeoutId);
    }
    this._autohideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTOHIDE_TIMEOUT, () => {
      if (this._isDestroyed) {
        this._autohideTimeoutId = 0;
        return GLib.SOURCE_REMOVE;
      }
      if (this._dashContainerHasHover() || this._blockAutoHide || this._isMenuOpen()) {
        return GLib.SOURCE_CONTINUE;
      }

      this.hide(true);
      this._autohideTimeoutId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  private _ensureHoverState(): void {
    if (this._isDestroyed) return;
    if (this._blockAutoHideDelayId !== 0) {
      this._blockAutoHideDelayId = this._removeSource(this._blockAutoHideDelayId);
    }
    this._blockAutoHideDelayId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      if (!this._isDestroyed) {
        if (this._dashContainerHasHover()) this.show(false);
      }
      this._blockAutoHideDelayId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  private _isFullyShown(): boolean {
    return (
      this.visible &&
      this.translation_y === 0 &&
      this.scale_x === 1 &&
      this.scale_y === 1 &&
      this.opacity === FULL_OPACITY
    );
  }

  private _isFullyHidden(): boolean {
    return !this.visible && this.opacity === 0;
  }

  private _getAllocationSize(): { width: number; height: number } | null {
    const alloc = this.get_allocation_box?.();
    if (!alloc) return null;

    const width = Math.max(0, (alloc.x2 ?? 0) - (alloc.x1 ?? 0));
    const height = Math.max(0, (alloc.y2 ?? 0) - (alloc.y1 ?? 0));
    return width > 0 && height > 0 ? { width, height } : null;
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

    if (!this.visible || this.translation_y !== 0) return;

    const [stageX, stageY] = (this as any).get_transformed_position?.() ?? [0, 0];

    const bounds: DashBounds = {
      x: stageX,
      y: stageY,
      width: size.width,
      height: size.height,
    };

    if (!AuroraDash._boundsEqual(this._targetBox, bounds)) {
      this._targetBox = bounds;
      this._targetBoxListener?.(this._targetBox);
    }

    this._flushPendingShow();
  }

  private _flushPendingShow(): void {
    if (!this._pendingShow || !this._hasValidAllocation()) return;

    const { animate } = this._pendingShow;
    this._pendingShow = null;
    this._performShow(animate);
  }

  private _getMarginBottom(): number {
    if (this._flushMode) return 0;
    try {
      return (this as unknown as St.Widget).get_theme_node().get_length('margin-bottom');
    } catch {
      return 0;
    }
  }

  /**
   * Coalesce work-area resizes into a single deferred update. Uses
   * PRIORITY_DEFAULT (not PRIORITY_DEFAULT_IDLE): active drag motion floods
   * the idle queue, so a low-priority idle source is starved and the
   * container never resizes mid-drag while the placeholder is in/out.
   */
  private _queueWorkAreaUpdate(): void {
    if (this._isDestroyed || this._workAreaUpdateId) return;
    this._workAreaUpdateId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._workAreaUpdateId = 0;
      if (this._workArea) {
        this.applyWorkArea(this._workArea);
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  private static _boundsEqual(a: DashBounds | null, b: DashBounds | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }
}
