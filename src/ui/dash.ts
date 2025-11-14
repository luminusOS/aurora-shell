
import '@girs/gjs';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from '@girs/gnome-shell/ui/main';
// @ts-ignore: GNOME Shell resolves resource:// imports at runtime
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';

export interface AuroraDashParams {
  monitorIndex?: number;
}

export interface DashBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TARGET_BOX_PADDING = 8;

@GObject.registerClass
export class AuroraDash extends Dash.Dash {
  private _monitorIndex = Main.layoutManager.primaryIndex;
  private _container: St.Bin | null = null;
  private _targetBox: DashBounds | null = null;
  private _containerAllocationId = 0;
  private _containerDestroyId = 0;
  private _targetBoxListener: ((bounds: DashBounds | null) => void) | null = null;

  _init(params: AuroraDashParams = {}): void {
    super._init(params);

    if (typeof params.monitorIndex === 'number') {
      this._monitorIndex = params.monitorIndex;
    }

    const widget = this as unknown as St.Widget;
    widget.set_x_expand(true);
    widget.set_y_expand(false);

    const button = (this as any).showAppsButton;
    if (button?.set_toggle_mode) {
      button.set_toggle_mode(false);
    }
  }

  get monitorIndex(): number {
    return this._monitorIndex;
  }

  set monitorIndex(index: number) {
    this._monitorIndex = index;
  }

  attachContainer(container: St.Bin): void {
    this._detachContainerSignals();
    this._container = container;

    const containerAny = container as unknown as {
      connectObject?: (signal: string, handler: () => void, scope?: object) => void;
      disconnectObject?: (scope: object) => void;
    };

    if (typeof containerAny.connectObject === 'function') {
      containerAny.connectObject('notify::allocation', () => this._queueTargetBoxUpdate(), this);
      containerAny.connectObject('destroy', () => {
        if (this._container === container) {
          this._container = null;
        }
      }, this);
      return;
    }

    this._containerAllocationId = container.connect('notify::allocation', () => this._queueTargetBoxUpdate());
    this._containerDestroyId = container.connect('destroy', () => {
      if (this._container === container) {
        this._container = null;
      }
    });
  }

  detachContainer(): void {
    this._detachContainerSignals();
    this._container = null;
    this._targetBox = null;
    this._targetBoxListener?.(null);
  }

  updateLayout(container: St.Bin, workArea: DashBounds, referenceDash?: St.Widget | null): void {
    this.attachContainer(container);

    const { width, height } = this._resolveDashSize(workArea.width, workArea.height, referenceDash ?? (this as unknown as St.Widget));

    const marginBottom = this._dashMarginBottom(referenceDash ?? (this as unknown as St.Widget));
    const clampedWidth = Math.min(width, workArea.width);
    const clampedHeight = Math.min(height, workArea.height);

    const x = workArea.x + Math.round((workArea.width - clampedWidth) / 2);
    const y = Math.max(workArea.y, workArea.y + workArea.height - clampedHeight - marginBottom);

    container.set_size(clampedWidth, clampedHeight);
    container.set_position(x, y);

    const actor = this as unknown as St.Widget;
    actor.set_width(clampedWidth);
    actor.queue_relayout?.();

    this._updateTargetBox({ x, y, width: clampedWidth, height: clampedHeight });
  }

  refresh(): void {
    const dashAny = this as unknown as { _redisplay?: () => void; _queueRedisplay?: () => void };

    if (typeof dashAny._redisplay === 'function') {
      dashAny._redisplay();
      return;
    }

    if (typeof dashAny._queueRedisplay === 'function') {
      dashAny._queueRedisplay();
    }
  }

  get targetBox(): DashBounds | null {
    return this._targetBox;
  }

  private _resolveDashSize(workAreaWidth: number, workAreaHeight: number, referenceDash: St.Widget): { width: number; height: number } {
    let width = referenceDash?.width ?? 0;
    let height = referenceDash?.height ?? 0;

    if (referenceDash && (width === 0 || height === 0)) {
      const [, preferredWidth] = referenceDash.get_preferred_width(workAreaWidth);
      const [, preferredHeight] = referenceDash.get_preferred_height(preferredWidth);
      width = preferredWidth;
      height = preferredHeight;
    }

    if (width === 0 || height === 0) {
      const actor = this as unknown as St.Widget;
      const [, preferredWidth] = actor.get_preferred_width(workAreaWidth);
      const [, preferredHeight] = actor.get_preferred_height(preferredWidth);
      width = preferredWidth;
      height = preferredHeight;
    }

    width = Math.min(width, workAreaWidth);
    height = Math.min(height, workAreaHeight);

    return { width, height };
  }

  private _dashMarginBottom(actor: St.Widget | null): number {
    if (!actor || typeof actor.get_theme_node !== 'function') {
      return 0;
    }

    try {
      const node = actor.get_theme_node();
      return node.get_length('margin-bottom');
    } catch (_error) {
      return 0;
    }
  }

  private _updateTargetBox(bounds: DashBounds): void {
    const padded: DashBounds = {
      x: bounds.x - TARGET_BOX_PADDING,
      y: bounds.y - TARGET_BOX_PADDING,
      width: bounds.width + TARGET_BOX_PADDING * 2,
      height: bounds.height + TARGET_BOX_PADDING * 2,
    };

    if (this._hasSameBounds(this._targetBox, padded)) {
      return;
    }

    this._targetBox = padded;
    this._targetBoxListener?.(this._targetBox);
  }

  private _queueTargetBoxUpdate(): void {
    if (!this._container) {
      return;
    }

    const allocation = this._container.get_allocation_box?.();
    if (!allocation) {
      return;
    }

    const x = allocation.x1 ?? 0;
    const y = allocation.y1 ?? 0;
    const width = (allocation.x2 ?? x) - x;
    const height = (allocation.y2 ?? y) - y;

    this._updateTargetBox({ x, y, width, height });
  }

  private _hasSameBounds(first: DashBounds | null, second: DashBounds | null): boolean {
    if (!first && !second) {
      return true;
    }

    if (!first || !second) {
      return false;
    }

    return first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
  }

  private _detachContainerSignals(): void {
    if (!this._container) {
      return;
    }

    const containerAny = this._container as unknown as { disconnectObject?: (scope: object) => void };
    if (typeof containerAny.disconnectObject === 'function') {
      containerAny.disconnectObject(this);
    }

    if (this._containerAllocationId) {
      this._container.disconnect(this._containerAllocationId);
      this._containerAllocationId = 0;
    }

    if (this._containerDestroyId) {
      this._container.disconnect(this._containerDestroyId);
      this._containerDestroyId = 0;
    }
  }

  setTargetBoxListener(listener: ((bounds: DashBounds | null) => void) | null): void {
    this._targetBoxListener = listener;
    if (listener && this._targetBox) {
      listener(this._targetBox);
    }
  }
}

export type AuroraDashInstance = InstanceType<typeof AuroraDash>;
export type AuroraDashActor = AuroraDashInstance & Clutter.Actor;
