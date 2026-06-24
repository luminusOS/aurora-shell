import '@girs/gjs';

import St from '@girs/st-18';
import Clutter from '@girs/clutter-18';
import GLib from '@girs/glib-2.0';
import Meta from '@girs/meta-18';
import Shell from '@girs/shell-18';

import GObject from '@girs/gobject-2.0';
import * as Layout from '@girs/gnome-shell/ui/layout';

import { logger } from '~/core/logger.ts';
import type { DashBounds } from '~/shared/ui/dash.ts';

const LOG_PREFIX = 'DockHotArea';
const HOT_AREA_TRIGGER_SPEED = 150;
const HOT_AREA_TRIGGER_TIMEOUT = 550;
const HOT_AREA_DEBOUNCE_TIMEOUT = 250;

@GObject.registerClass({
  Signals: { triggered: {} },
})
export class DockHotArea extends St.Widget {
  private _pressureBarrier: Layout.PressureBarrier | null = null;
  private _horizontalBarrier: Meta.Barrier | null = null;
  private _monitor!: DashBounds;
  private _enabled = true;
  private _edgeArmed = true;
  private _grabSuppressed = false;
  private _pointerDwellTimeoutId = 0;

  override _init(monitor: DashBounds) {
    super._init({ reactive: true, visible: true, name: 'aurora-dock-hot-area' });
    this._monitor = monitor;

    this._pressureBarrier = new Layout.PressureBarrier(
      HOT_AREA_TRIGGER_SPEED,
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

          this._pointerDwellTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            HOT_AREA_DEBOUNCE_TIMEOUT,
            () => {
              logger.debug(`pointer dwell trigger geometry=${this._formatGeometry()}`, {
                prefix: LOG_PREFIX,
              });
              this.emit('triggered');
              this._pointerDwellTimeoutId = 0;
              return GLib.SOURCE_REMOVE;
            },
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
        if (this._enabled && !this._grabSuppressed && !this._edgeArmed) {
          this._edgeArmed = true;
          logger.debug(`rearmed after pointer leave geometry=${this._formatGeometry()}`, {
            prefix: LOG_PREFIX,
          });
        }
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
          if (this._enabled) this._edgeArmed = !this._isPointerInsideHotArea();
        }
      },
      this,
    );
  }

  setGeometry(monitor: DashBounds): void {
    this._monitor = monitor;
    if (this._enabled) this._rebuildBarrier(monitor.width);
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this._enabled && enabled === this.reactive) return;
    this._enabled = enabled;
    this.set_reactive(enabled);
    if (enabled) {
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

  override destroy(): void {
    global.display.disconnectObject(this);
    this._destroyBarrier();
    this._clearDebounceTimer();

    this._pressureBarrier?.disconnectObject?.(this);
    this._pressureBarrier?.destroy?.();
    this._pressureBarrier = null;

    super.destroy();
  }

  private _rebuildBarrier(size: number): void {
    if (!this._pressureBarrier) return;

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
    this._pressureBarrier?.removeBarrier(this._horizontalBarrier);
    this._horizontalBarrier.destroy();
    this._horizontalBarrier = null;
  }

  private _clearDebounceTimer(): void {
    if (this._pointerDwellTimeoutId) {
      GLib.source_remove(this._pointerDwellTimeoutId);
      this._pointerDwellTimeoutId = 0;
    }
  }

  private _canTrigger(): boolean {
    return this._enabled && this._edgeArmed && !this._grabSuppressed;
  }

  private _isPointerInsideHotArea(): boolean {
    const [pointerX, pointerY] = global.get_pointer();
    const monitor = this._monitor;
    const bottom = monitor.y + monitor.height;
    const top = bottom - Math.max(1, this.height || 1);
    return (
      pointerX >= monitor.x &&
      pointerX <= monitor.x + monitor.width &&
      pointerY >= top &&
      pointerY <= bottom
    );
  }

  private _formatGeometry(): string {
    const monitor = this._monitor;
    return `${monitor.x},${monitor.y} ${monitor.width}x${monitor.height}`;
  }
}
