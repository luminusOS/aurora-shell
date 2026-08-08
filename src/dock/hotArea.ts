import '@girs/gjs';

import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import GLib from '@girs/glib-2.0';
import Meta from '@girs/meta-18';
import Shell from '@girs/shell-18';

import GObject from '@girs/gobject-2.0';
import * as Layout from '@girs/gnome-shell/ui/layout';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import { EdgeGestureGuard } from '~/dock/edgeGestureGuard.ts';
import type { DashBounds } from '~/shared/ui/dash.ts';

const LOG_PREFIX = 'DockHotArea';
const HOT_AREA_PRESSURE_THRESHOLD = 150;
const HOT_AREA_TRIGGER_TIMEOUT = 550;
const HOT_AREA_DEBOUNCE_TIMEOUT = 250;
const POINTER_BUTTON_MASK =
  Clutter.ModifierType.BUTTON1_MASK |
  Clutter.ModifierType.BUTTON2_MASK |
  Clutter.ModifierType.BUTTON3_MASK |
  Clutter.ModifierType.BUTTON4_MASK |
  Clutter.ModifierType.BUTTON5_MASK;

export const DockHotArea = GObject.registerClass(
  {
    Signals: { triggered: {} },
  },
  class DockHotArea extends St.Widget {
    declare private _pressureBarrier: Layout.PressureBarrier;
    private _horizontalBarrier: Meta.Barrier | null = null;
    private _monitor!: DashBounds;
    private _active = true;
    private _edgeArmed = true;
    private _grabSuppressed = false;
    declare private _lifecycle: LifecycleScope;
    declare private _pointerDwellTimeout: ManagedSource;
    private _gestureGuard = new EdgeGestureGuard();

    override _init(monitor: DashBounds) {
      super._init({ reactive: true, visible: true, name: 'aurora-dock-hot-area' });
      this._lifecycle = new LifecycleScope();
      this._pointerDwellTimeout = createManagedSource(this._lifecycle);
      this._monitor = monitor;

      this._pressureBarrier = new Layout.PressureBarrier(
        HOT_AREA_PRESSURE_THRESHOLD,
        HOT_AREA_TRIGGER_TIMEOUT,
        Shell.ActionMode.ALL,
      );

      this._pressureBarrier.connectObject(
        'trigger',
        () => {
          if (this._canTrigger()) {
            logger.debug(`pressure trigger geometry=${this._formatGeometry()}`, {
              prefix: LOG_PREFIX,
            });
            this.emit('triggered');
          }
        },
        this,
      );

      this.connectObject(
        'enter-event',
        () => {
          if (this._canTrigger()) {
            this._clearDebounceTimer();

            this._pointerDwellTimeout.replace(() =>
              GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOT_AREA_DEBOUNCE_TIMEOUT, () => {
                logger.debug(`pointer dwell trigger geometry=${this._formatGeometry()}`, {
                  prefix: LOG_PREFIX,
                });
                this.emit('triggered');
                this._pointerDwellTimeout.complete();
                return GLib.SOURCE_REMOVE;
              }),
            );
          }
          return Clutter.EVENT_PROPAGATE;
        },
        this,
      );

      this.connectObject(
        'leave-event',
        () => {
          this._clearDebounceTimer();
          this._gestureGuard.resetAfterPointerLeave();
          if (this._active && !this._grabSuppressed && !this._edgeArmed) {
            this._edgeArmed = true;
            logger.debug(`rearmed after pointer leave geometry=${this._formatGeometry()}`, {
              prefix: LOG_PREFIX,
            });
          }
          return Clutter.EVENT_PROPAGATE;
        },
        this,
      );

      this.connectObject(
        'scroll-event',
        () => {
          this._suppressActivePointerGesture('scroll');
          return Clutter.EVENT_PROPAGATE;
        },
        this,
      );

      global.display.connectObject(
        'grab-op-begin',
        (_d: any, _w: any, op: Meta.GrabOp) => {
          if (op === Meta.GrabOp.MOVING) {
            this._grabSuppressed = true;
            this._edgeArmed = false;
            this._clearDebounceTimer();
          }
        },
        'grab-op-end',
        (_d: any, _w: any, op: Meta.GrabOp) => {
          if (op === Meta.GrabOp.MOVING) {
            this._grabSuppressed = false;
            if (this._active) this._edgeArmed = !this._isPointerInsideHotArea();
          }
        },
        this,
      );
    }

    setGeometry(monitor: DashBounds): void {
      this._monitor = monitor;
      if (this._active) this._rebuildBarrier(monitor.width);
    }

    setEnabled(enabled: boolean): void {
      if (enabled === this._active && enabled === this.reactive) return;
      this._active = enabled;
      this.set_reactive(enabled);
      if (enabled) {
        this._gestureGuard.resetAfterPointerLeave();
        this._edgeArmed = !this._isPointerInsideHotArea() && !this._grabSuppressed;
        logger.debug(`enabled=true armed=${this._edgeArmed} geometry=${this._formatGeometry()}`, {
          prefix: LOG_PREFIX,
        });
        this._rebuildBarrier(this._monitor.width);
      } else {
        this._edgeArmed = false;
        logger.debug(`enabled=false geometry=${this._formatGeometry()}`, {
          prefix: LOG_PREFIX,
        });
        this._clearDebounceTimer();
        this._destroyBarrier();
      }
    }

    beginCooldown(durationMs: number, reason: string): void {
      this._gestureGuard.beginCooldown(this._nowMs(), durationMs);
      this._clearDebounceTimer();
      logger.debug(`cooldown=${durationMs}ms reason=${reason} geometry=${this._formatGeometry()}`, {
        prefix: LOG_PREFIX,
      });
    }

    canStartContextualDragReveal(x: number, y: number): boolean {
      return (
        this._active &&
        !this._grabSuppressed &&
        !this._gestureGuard.isCoolingDown(this._nowMs()) &&
        this._containsPoint(x, y)
      );
    }

    override destroy(): void {
      this._lifecycle.dispose();
      global.display.disconnectObject(this);
      this._pressureBarrier.disconnectObject(this);

      this._destroyBarrier();
      this._pressureBarrier.destroy();

      super.destroy();
    }

    private _rebuildBarrier(size: number): void {
      this._destroyBarrier();

      const width = Number.isFinite(size) ? size : 0;
      const left = this._monitor.x;
      const bottom = this._monitor.y + this._monitor.height;

      if (width <= 0 || !Number.isFinite(left) || !Number.isFinite(bottom)) return;

      this._horizontalBarrier = new Meta.Barrier({
        backend: global.backend,
        x1: left,
        x2: left + width,
        y1: bottom,
        y2: bottom,
        directions: Meta.BarrierDirection.POSITIVE_Y,
      });

      this._pressureBarrier.addBarrier(this._horizontalBarrier);
    }

    private _destroyBarrier(): void {
      if (!this._horizontalBarrier) return;

      this._pressureBarrier.removeBarrier(this._horizontalBarrier);
      this._horizontalBarrier.destroy();
      this._horizontalBarrier = null;
    }

    private _clearDebounceTimer(): void {
      this._pointerDwellTimeout.clear();
    }

    private _canTrigger(): boolean {
      const [, , modifiers] = global.get_pointer();
      if (this._gestureGuard.observeModifiers(Number(modifiers), POINTER_BUTTON_MASK)) {
        this._suppressActivePointerGesture('pressed pointer button');
        return false;
      }
      return (
        this._active &&
        this._edgeArmed &&
        !this._grabSuppressed &&
        !this._gestureGuard.isCoolingDown(this._nowMs())
      );
    }

    private _suppressActivePointerGesture(reason: string): void {
      const newlySuppressed = this._gestureGuard.suppressUntilLeave();
      this._edgeArmed = false;
      this._clearDebounceTimer();
      if (newlySuppressed) {
        logger.debug(`suppressed ${reason}; waiting for pointer leave`, {
          prefix: LOG_PREFIX,
        });
      }
    }

    private _isPointerInsideHotArea(): boolean {
      const [pointerX, pointerY] = global.get_pointer();
      return this._containsPoint(pointerX, pointerY);
    }

    private _containsPoint(pointerX: number, pointerY: number): boolean {
      const bottom = this._monitor.y + this._monitor.height;
      const top = bottom - Math.max(1, this.height || 1);
      return (
        pointerX >= this._monitor.x &&
        pointerX <= this._monitor.x + this._monitor.width &&
        pointerY >= top &&
        pointerY <= bottom
      );
    }

    private _nowMs(): number {
      return GLib.get_monotonic_time() / 1000;
    }

    private _formatGeometry(): string {
      return `${this._monitor.x},${this._monitor.y} ${this._monitor.width}x${this._monitor.height}`;
    }
  },
);

export type DockHotArea = InstanceType<typeof DockHotArea>;
