// @ts-nocheck
import '@girs/gjs';

import St from '@girs/st-17';
import Clutter from '@girs/clutter-17';
import GObject from '@girs/gobject-2.0';
import GLib from '@girs/glib-2.0';
import Meta from '@girs/meta-17';
import Shell from '@girs/shell-17';

import * as Layout from '@girs/gnome-shell/ui/layout';

import type { DashBounds } from '../../ui/dash.ts';

const HOT_AREA_TRIGGER_SPEED = 150;
const HOT_AREA_TRIGGER_TIMEOUT = 550;
const HOT_AREA_DEBOUNCE_TIMEOUT = 250;

/**
 * Invisible input barrier at the bottom screen edge.
 *
 * Uses a GNOME Shell PressureBarrier plus a thin reactive widget to detect
 * when the user pushes the pointer against the bottom edge, then emits
 * 'triggered' so the Dock module can reveal the dash.
 */
@GObject.registerClass({
  Signals: { triggered: {} },
})
export class DockHotArea extends St.Widget {
  private _pressureBarrier: any;
  private _horizontalBarrier: Meta.Barrier | null = null;
  private _triggerAllowed = true;
  private _monitor: DashBounds;
  private _pointerDwellTimeoutId = 0;

  _init(monitor: DashBounds) {
    super._init({ reactive: true, visible: true, name: 'aurora-dock-hot-area' });
    this._monitor = monitor;

    this._pressureBarrier = new Layout.PressureBarrier(
      HOT_AREA_TRIGGER_SPEED,
      HOT_AREA_TRIGGER_TIMEOUT,
      Shell.ActionMode.ALL
    );

    this._pressureBarrier.connectObject('trigger', () => {
      if (this._triggerAllowed) this.emit('triggered');
    }, this);

    this.connectObject('enter-event', () => {
      if (this._triggerAllowed) {
        this._pointerDwellTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOT_AREA_DEBOUNCE_TIMEOUT, () => {
          this.emit('triggered');
          this._pointerDwellTimeoutId = 0;
          return GLib.SOURCE_REMOVE;
        });
      }
      return Clutter.EVENT_PROPAGATE;
    }, this);

    this.connectObject('leave-event', () => {
      if (this._pointerDwellTimeoutId) {
        GLib.source_remove(this._pointerDwellTimeoutId);
        this._pointerDwellTimeoutId = 0;
      }
      return Clutter.EVENT_PROPAGATE;
    }, this);

    // Suppress triggers while the user is dragging a window
    global.display.connectObject(
      'grab-op-begin', (_d: any, _w: any, op: Meta.GrabOp) => {
        if (op === Meta.GrabOp.MOVING) this._triggerAllowed = false;
      },
      'grab-op-end', (_d: any, _w: any, op: Meta.GrabOp) => {
        if (op === Meta.GrabOp.MOVING) this._triggerAllowed = true;
      },
      this
    );
  }

  setGeometry(monitor: DashBounds): void {
    this._monitor = monitor;
    this._rebuildBarrier(monitor.width);
  }

  override destroy(): void {
    global.display.disconnectObject(this);
    this._destroyBarrier();

    if (this._pointerDwellTimeoutId) {
      GLib.source_remove(this._pointerDwellTimeoutId);
      this._pointerDwellTimeoutId = 0;
    }

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
}
