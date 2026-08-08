import '@girs/gjs';
import GLib from '@girs/glib-2.0';
import Clutter from '@girs/clutter-18';
import GObject from '@girs/gobject-2.0';
import Shell from '@girs/shell-18';
import type St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';
import * as DND from '@girs/gnome-shell/ui/dnd';
import { Dash } from '@girs/gnome-shell/ui/dash';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import { UnredirectInhibitor } from '~/core/unredirectInhibitor.ts';
import { DashFixedItems } from '~/shared/ui/dashFixedItems.ts';
import { DashApplicationController } from '~/shared/ui/dashApplications.ts';
import { DashSpringLoadCoordinator } from '~/shared/ui/dashSpringLoad.ts';
import { DashVisibilityController } from '~/shared/ui/dashVisibility.ts';
import {
  boundsContainPoint,
  boundsEqual,
  calculateDashPlacement,
  type DashBounds,
} from '~/shared/ui/dashLayout.ts';

export type { DashBounds } from '~/shared/ui/dashLayout.ts';

type TargetBoxListener = (bounds: DashBounds | null) => void;

const ANIMATION_TIME = 200;

interface AuroraDashParams {
  monitorIndex?: number;
  isolateMonitor?: boolean;
  showTrash?: boolean;
  showExternalStorage?: boolean;
}

export const AuroraDash = GObject.registerClass(
  class AuroraDash extends Dash {
    declare private _monitorIndex: number;
    declare private _isolateMonitor: boolean;
    private _workArea: DashBounds | null = null;
    private _container: St.Bin | null = null;
    declare private _dashBox: St.Widget | null;
    declare private _lifecycle: LifecycleScope;
    declare private _workAreaUpdate: ManagedSource;
    declare private _iconResizeTimeout: ManagedSource;
    private _targetBox: DashBounds | null = null;
    private _flushMode = false;
    private _targetBoxListener: TargetBoxListener | null = null;
    declare private _visibility: DashVisibilityController;
    declare private _springLoad: DashSpringLoadCoordinator;
    declare private _fixedItems: DashFixedItems;
    declare private _applications: DashApplicationController;
    declare private _unredirectInhibitor: UnredirectInhibitor;

    override _init(params: AuroraDashParams = {}): void {
      super._init();

      const {
        monitorIndex = Main.layoutManager.primaryIndex,
        isolateMonitor = true,
        showTrash = false,
        showExternalStorage = false,
      } = params;

      this._lifecycle = new LifecycleScope();
      this._workAreaUpdate = createManagedSource(this._lifecycle);
      this._iconResizeTimeout = createManagedSource(this._lifecycle);

      this._monitorIndex = monitorIndex;
      this._isolateMonitor = isolateMonitor;
      this._unredirectInhibitor = new UnredirectInhibitor(global.compositor);
      this._visibility = new DashVisibilityController(this, {
        getContentActor: () => this._dashBox,
        getContainer: () => this._container,
        getMonitorIndex: () => this._monitorIndex,
        getWorkArea: () => this._workArea,
        isMenuOpen: () => this._isMenuOpen(),
        applyWorkArea: (workArea) => this.applyWorkArea(workArea),
        queueTargetBoxUpdate: () => this._queueTargetBoxUpdate(),
        showActor: () => Dash.prototype.show.call(this),
        hideActor: () => Dash.prototype.hide.call(this),
      });
      this.connect('notify::mapped', () => this._unredirectInhibitor.setInhibited(this.mapped));

      const button = this.showAppsButton;
      button.set_toggle_mode(false);
      button.connectObject('clicked', () => Main.overview.showApps(), this);

      const dashContainer = this._dashContainer;
      dashContainer.set_track_hover(true);
      dashContainer.set_reactive(true);
      dashContainer.connectObject(
        'notify::hover',
        () => {
          this._visibility.setHovered(dashContainer.get_hover());
        },
        'destroy',
        () => this._onDashContainerDestroyed(),
        this,
      );

      this.set_x_align(Clutter.ActorAlign.CENTER);
      this.set_y_align(Clutter.ActorAlign.END);
      this.set_x_expand(false);
      this.set_y_expand(false);

      this.connectObject('notify::allocation', () => this._queueTargetBoxUpdate(), this);

      // Track _box allocation so the chrome container follows the dash's
      // preferred width every frame. Critical during drag: the placeholder
      // animates scale 0→1, so a one-shot resize would lock the container
      // at the half-scaled width.
      const box = this._box;
      this._dashBox = box;
      box.connectObject(
        'notify::allocation',
        () => this._queueWorkAreaUpdate(),
        'destroy',
        () => this._onDashContentDestroyed(box),
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

      this._springLoad = new DashSpringLoadCoordinator(
        () => this._box,
        (window) => this._applications.isWindowRelevant(window),
      );

      this._applications = new DashApplicationController({
        getContentActor: () => this._dashBox,
        getMonitorIndex: () => this._monitorIndex,
        getIsolateMonitor: () => this._isolateMonitor,
      });

      this._fixedItems = new DashFixedItems(this, this, showTrash, showExternalStorage, () => {
        this._queueRedisplay();
        if (this._workArea) this._queueWorkAreaUpdate();
      });
    }

    private _onDashContainerDestroyed(): void {
      this._dashBox = null;
      this._visibility.handleContainerDestroyed();
      Reflect.deleteProperty(this, '_dashContainer');
    }

    private _onDashContentDestroyed(box: St.Widget): void {
      if (this._dashBox === box) {
        this._dashBox = null;
      }

      this._visibility.handleContainerDestroyed();
    }

    get monitorIndex(): number {
      return this._monitorIndex;
    }

    canAcceptContextualEdgeDrag(source: any): boolean {
      if (source === Main.xdndHandler) return true;

      const app = Dash.getAppFromSource(source);
      return (
        app !== null &&
        !app.is_window_backed() &&
        Boolean(global.settings.is_writable('favorite-apps'))
      );
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
      return this._visibility.hovered;
    }

    containsStagePoint(x: number, y: number): boolean {
      return (
        boundsContainPoint(this._getActorStageBounds(this._container), x, y) ||
        boundsContainPoint(this._getActorStageBounds(this), x, y) ||
        boundsContainPoint(this._targetBox, x, y)
      );
    }

    override destroy(): void {
      this._lifecycle.dispose();
      this._visibility.destroy();
      this._springLoad.destroy();

      // Remove the global DND drag monitor so its captured `this` doesn't
      // keep firing against a disposed AuroraDash if the dash is destroyed
      // mid-drag (e.g. monitor or settings change). Stock _endItemDrag
      // removes it on drag end but never on early disposal.
      const dashAny = this as any;
      if (dashAny._dragMonitor) {
        DND.removeDragMonitor(dashAny._dragMonitor);
        dashAny._dragMonitor = null;
      }

      this.showAppsButton.disconnectObject(this);

      if (this._dashBox) {
        this._dashBox.disconnectObject(this);
        this._dashBox = null;
      }

      Main.overview.disconnectObject(this);
      global.display.disconnectObject(this);
      global.workspace_manager.disconnectObject(this);
      (this as any)._dashContainer.disconnectObject(this);
      this._container?.disconnectObject(this);
      (global.backend as any).get_dnd().disconnectObject(this);

      this._fixedItems.destroy();
      this._unredirectInhibitor.release();
      this._container = null;
      this._targetBox = null;

      super.destroy();
    }

    override _queueRedisplay(): void {
      if (!this._dashBox) return;

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
      const items: any[] = [...this._applications.getChildren(), (this as any)._showAppsIcon];
      for (const item of items) {
        if (!item?.label) continue;

        if (this._flushMode) {
          item.label.add_style_class_name('flush-mode');
        } else {
          item.label.remove_style_class_name('flush-mode');
        }
      }
    }

    setTargetBoxListener(listener: TargetBoxListener | null): void {
      this._targetBoxListener = listener;
      if (listener) listener(this._targetBox);
    }

    attachToContainer(container: St.Bin): void {
      if (this._container === container) return;

      this._container?.disconnectObject(this);
      this._container = container;

      container.connectObject(
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
      this._container?.disconnectObject(this);
      this._container = null;
      this._targetBox = null;
      if (this._targetBoxListener) this._targetBoxListener(null);
      this._visibility.handleContainerDetached();
    }

    applyWorkArea(workArea: DashBounds): void {
      if (!this._dashBox) return;

      this._workArea = workArea;
      if (!this._container) return;

      // Provide the dash with its maximum bounds so it can automatically
      // shrink the iconSize when there are too many apps to fit.
      this.setMaxSize(workArea.width, workArea.height);

      const [, prefW] = this.get_preferred_width(workArea.width);
      const width = Math.min(Math.max(prefW, 0), workArea.width);

      const [, prefH] = this.get_preferred_height(width || workArea.width);
      const placement = calculateDashPlacement(workArea, prefW, prefH, this._getMarginBottom());

      this._container.set_size(placement.width, placement.height);
      this._container.set_position(placement.x, placement.y);
      this._queueTargetBoxUpdate();
    }

    blockAutoHide(block: boolean): void {
      this._visibility.blockAutoHide(block);
    }

    forceAutoHide(animate = true): void {
      this._visibility.forceAutoHide(animate);
    }

    ensureAutoHide(): void {
      this._visibility.ensureAutoHide();
    }

    override show(animate = true, onComplete?: () => void): void {
      this._visibility.show(animate, onComplete);
    }

    override hide(animate = true): void {
      this._visibility.hide(animate);
    }

    private _isMenuOpen(): boolean {
      const children = this._applications.getChildren();

      for (const child of children) {
        const appIcon = child.child?._delegate;

        if (appIcon?._menu?.isOpen) {
          return true;
        }
      }

      if (this._fixedItems.menuOpen) return true;

      return false;
    }

    private _getActorStageBounds(actor: Clutter.Actor | null): DashBounds | null {
      if (!actor?.visible) return null;

      const allocation = actor.get_allocation_box();
      const width = Math.max(0, allocation.x2 - allocation.x1);
      const height = Math.max(0, allocation.y2 - allocation.y1);
      if (width <= 0 || height <= 0) return null;

      const [x, y] = actor.get_transformed_position();
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

      return { x, y, width, height };
    }

    // Stock Dash._init() connects item-drag-* / window-drag-* via bare
    // connect() (no disconnect on destroy), so signals keep firing after the
    // GObject is disposed. The shared super call guards disposal; item dragging
    // additionally holds visibility while the placeholder changes hover state.
    private _guardedSuper(method: string, args: any[] = []): void {
      if (!this._dashBox) return;

      (Dash.prototype as any)[method].call(this, ...args);
    }

    override _onItemDragBegin(): void {
      this._visibility.beginItemDrag();
      this._guardedSuper('_onItemDragBegin');
    }

    override _onItemDragEnd(): void {
      this._guardedSuper('_onItemDragEnd');
      this._visibility.endItemDrag();
    }

    override _onItemDragCancelled(): void {
      this._guardedSuper('_onItemDragCancelled');
      this._visibility.endItemDrag();
    }

    override _onWindowDragBegin(...a: any[]): void {
      this._guardedSuper('_onWindowDragBegin', a);
    }
    override _onWindowDragEnd(...a: any[]): void {
      this._guardedSuper('_onWindowDragEnd', a);
    }

    override _syncLabel(item: any, appIcon: any): void {
      if (!this._dashBox) return;

      if (item && !item._auroraShowLabelPatched) {
        item._auroraShowLabelPatched = true;
        const originalShowLabel = item.showLabel;
        item.showLabel = function () {
          if (!this.label) return;
          originalShowLabel.call(this);
        };
      }

      (Dash.prototype as any)._syncLabel.call(this, item, appIcon);
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
        const app = (item.child as any)?._delegate?.app;
        const appId = app ? app.get_id() : undefined;
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

    override _adjustIconSize(): void {
      if (!this._dashBox) return;

      const box = this._box;
      const extraIcons = this._fixedItems.icons;

      if (!box || extraIcons.length === 0) {
        (Dash.prototype as any)._adjustIconSize.call(this);
        return;
      }

      // Stock _adjustIconSize splits the available width among _box children
      // plus the show-apps button only. The trash and external-storage icons
      // live in _dashContainer, so their width is never counted and the dash
      // keeps an oversized iconSize that overflows the work area. They share
      // the DashItemContainer anatomy (child._delegate.icon) the stock filter
      // expects, so appending them to the measured child list makes the stock
      // math — width budget and per-icon resize — cover them too.
      const hadOwnProp = Object.prototype.hasOwnProperty.call(box, 'get_children');
      const origGetChildren = box.get_children;
      box.get_children = () => [...origGetChildren.call(box), ...extraIcons];
      try {
        (Dash.prototype as any)._adjustIconSize.call(this);
      } finally {
        if (hadOwnProp) {
          box.get_children = origGetChildren;
        } else {
          Reflect.deleteProperty(box, 'get_children');
        }
      }
    }

    override _redisplay(): void {
      if (!this._dashBox) return;

      const dashAny = this as any;
      const oldIconSize = dashAny.iconSize;
      const shouldAnimate = this.visible && this.opacity > 0;

      const isFirstDisplay = !dashAny._shownInitially;
      const existingApps = new Set<any>();
      for (const child of this._applications.getChildren()) {
        const app = child.child?._delegate?.app;
        if (app && !child.animatingOut) existingApps.add(app);
      }

      // Temporarily patch get_running() so the base Dash only sees apps in the
      // active workspace. Per-monitor docks also isolate their apps by monitor;
      // the single primary dock aggregates apps from every monitor instead.
      // _globallyRunningIds lets the _createAppItem.destroy patch distinguish
      // actual closes from scope-filter removals (instant destroy, no ghost icons).
      const appSystem = dashAny._appSystem;
      const originalGetRunning = appSystem.get_running;
      const hadOwnGetRunning = Object.prototype.hasOwnProperty.call(appSystem, 'get_running');
      const allApps: any[] = originalGetRunning.call(appSystem);
      dashAny._globallyRunningIds = new Set<string>(allApps.map((app: any) => app.get_id()));

      const isRelevant = (window: any) => this._applications.isWindowRelevant(window);
      appSystem.get_running = () => {
        const apps = allApps.filter((app: any) => {
          if (app.get_state() === Shell.AppState.STARTING) return true;
          return app.get_windows().some(isRelevant);
        });

        return apps.sort((a: any, b: any) => {
          const minimumSequence = (app: any): number => {
            const windows: any[] = app.get_windows();
            if (windows.length === 0) return Number.MAX_SAFE_INTEGER;

            return windows.reduce(
              (minimum: number, window: any) => Math.min(minimum, window.get_stable_sequence()),
              Number.MAX_SAFE_INTEGER,
            );
          };

          return minimumSequence(a) - minimumSequence(b);
        });
      };

      try {
        Dash.prototype._redisplay.call(this);
      } finally {
        if (hadOwnGetRunning) {
          appSystem.get_running = originalGetRunning;
        } else {
          delete appSystem.get_running;
        }
        delete dashAny._globallyRunningIds;
      }

      if (shouldAnimate && !isFirstDisplay) {
        for (const child of this._applications.getChildren()) {
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
        }
      }

      this._applications.updateRunningDots();
      this._syncLabelFlushMode();
      this._applications.installActivationOverrides();

      if (dashAny.iconSize !== oldIconSize) {
        this._iconResizeTimeout.replace(() =>
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, ANIMATION_TIME, () => {
            this._iconResizeTimeout.complete();
            if (this._workArea) this.applyWorkArea(this._workArea);
            return GLib.SOURCE_REMOVE;
          }),
        );
      } else if (this._workArea) {
        this._queueWorkAreaUpdate();
      }
    }

    private _getAllocationSize(): { width: number; height: number } | null {
      const allocation = this.get_allocation_box();
      const width = Math.max(0, allocation.x2 - allocation.x1);
      const height = Math.max(0, allocation.y2 - allocation.y1);
      return width > 0 && height > 0 ? { width, height } : null;
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

      const [stageX, stageY] = this.get_transformed_position();

      const bounds: DashBounds = {
        x: stageX,
        y: stageY,
        width: size.width,
        height: size.height,
      };

      if (!boundsEqual(this._targetBox, bounds)) {
        this._targetBox = bounds;
        if (this._targetBoxListener) this._targetBoxListener(this._targetBox);
      }

      this._visibility.flushPendingShow();
    }

    private _getMarginBottom(): number {
      if (this._flushMode) return 0;

      return this.get_theme_node().get_length('margin-bottom');
    }

    /**
     * Coalesce work-area resizes into a single deferred update. Uses
     * PRIORITY_DEFAULT (not PRIORITY_DEFAULT_IDLE): active drag motion floods
     * the idle queue, so a low-priority idle source is starved and the
     * container never resizes mid-drag while the placeholder is in/out.
     */
    private _queueWorkAreaUpdate(): void {
      if (!this._dashBox || this._workAreaUpdate.active) return;
      this._workAreaUpdate.replace(() =>
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          this._workAreaUpdate.complete();
          if (this._workArea) {
            this.applyWorkArea(this._workArea);
          }
          return GLib.SOURCE_REMOVE;
        }),
      );
    }
  },
);

export type AuroraDash = InstanceType<typeof AuroraDash>;
