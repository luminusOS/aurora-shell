// @ts-nocheck
/* eslint-disable @typescript-eslint/consistent-type-imports */
import '@girs/gjs';
import GLib from '@girs/glib-2.0';
import Clutter from '@girs/clutter-17';
import St from '@girs/st-17';
import GObject from '@girs/gobject-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
// @ts-ignore: GNOME Shell resolves resource:// imports at runtime
import { Dash } from 'resource:///org/gnome/shell/ui/dash.js';

export interface DashBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LAYOUT_TARGET_BOX_PADDING = 8;
type TargetBoxListener = (bounds: DashBounds | null) => void;

const DOCK_AUTOHIDE_TIMEOUT = 500;
const DOCK_ANIMATION_TIME = 200;
const DOCK_VISIBILITY_ANIMATION_TIME = 200;
const DOCK_HIDE_SCALE = 0.98;
const MINIMUM_PROPERTY_EASE_DURATION_FACTOR = 0.8;

interface AuroraDashParams {
  monitorIndex?: number;
}

@GObject.registerClass
export class AuroraDash extends Dash {
  private _monitorIndex = Main.layoutManager.primaryIndex;
  private _workArea: DashBounds | null = null;
  private _dashBounds: DashBounds | null = null;
  private _container: St.Bin | null = null;
  private _containerAllocationId = 0;
  private _containerDestroyId = 0;
  private _dashAllocationId = 0;
  private _autohideTimeoutId = 0;
  private _delayEnsureAutoHideId = 0;
  private _blockAutoHideDelayId = 0;
  private _menuOpened = false;
  private _targetBox: DashBounds | null = null;
  private _blockAutoHide = false;
  private _draggingItem = false;
  private _targetBoxListener: TargetBoxListener | null = null;

  _init(params: AuroraDashParams = {}): void {
    super._init(params);
    if (typeof params.monitorIndex === 'number') {
      this._monitorIndex = params.monitorIndex;
    }

    const button = (this as any).showAppsButton;
    button?.set_toggle_mode?.(false);
    button?.connectObject?.('clicked', () => Main.overview.showApps(), this);

    Main.overview.connectObject(
      'item-drag-begin', () => {
        this._draggingItem = true;
        this._onHover();
      },
      'item-drag-end', () => {
        this._draggingItem = false;
        this._onHover();
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

    this._dashAllocationId = this.connect('notify::allocation', () => this._queueTargetBoxUpdate());
  }

  get monitorIndex(): number {
    return this._monitorIndex;
  }

  set monitorIndex(index: number) {
    if (this._monitorIndex === index) {
      return;
    }
    this._monitorIndex = index;
    this._workArea = null;
  }

  get targetBox(): DashBounds | null {
    return this._targetBox;
  }

  override destroy(): void {
    this._clearTimeout('_autohideTimeoutId');
    this._clearTimeout('_delayEnsureAutoHideId');
    this._clearTimeout('_blockAutoHideDelayId');

    (this as any).showAppsButton?.disconnectObject?.(this);
    this.disconnectObject?.(this);
    Main.overview.disconnectObject(this);
    const dashContainer = (this as any)._dashContainer;
    dashContainer?.disconnectObject?.(this);
    this._detachContainerSignals();
    this._container = null;
    this._targetBox = null;

    if (this._dashAllocationId) {
      this.disconnect(this._dashAllocationId);
      this._dashAllocationId = 0;
    }

    super.destroy();
  }

  refresh(): void {
    const dashAny = this as unknown as { _redisplay?: () => void; _queueRedisplay?: () => void };
    if (typeof dashAny._redisplay === 'function') {
      dashAny._redisplay();
      return;
    }
    dashAny._queueRedisplay?.();
  }

  setTargetBoxListener(listener: TargetBoxListener | null): void {
    this._targetBoxListener = listener;
    if (listener) {
      listener(this._targetBox);
    }
  }

  attachToContainer(container: St.Bin): void {
    if (this._container === container) {
      return;
    }
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

    this._queueTargetBoxUpdate();
  }

  detachFromContainer(): void {
    this._detachContainerSignals();
    this._container = null;
    this._dashBounds = null;
    this._targetBox = null;
    this._targetBoxListener?.(null);
  }

  applyWorkArea(workArea: DashBounds): void {
    this._workArea = workArea;
    const container = this._container;
    if (!container) {
      return;
    }

    const [, preferredWidth] = this.get_preferred_width(workArea.width);
    const width = Math.min(Math.max(preferredWidth, 0), workArea.width);

    const [, preferredHeight] = this.get_preferred_height(width || workArea.width);
    const height = Math.min(Math.max(preferredHeight, 0), workArea.height);

    const marginBottom = this._dashMarginBottom((this as unknown as St.Widget) ?? null);
    const x = workArea.x + Math.round((workArea.width - width) / 2);
    const y = Math.max(workArea.y, workArea.y + workArea.height - height - marginBottom);

    container.set_size(width, height);
    container.set_position(x, y);

    this._queueTargetBoxUpdate();
  }

  blockAutoHide(block: boolean): void {
    this._blockAutoHide = block;
    const shouldShow = this._blockAutoHide && !Main.overview.visible;
    if (shouldShow) {
      this.show(true);
    } else if (!block) {
      this._ensureHoverState();
    }
    this._onHover();
  }

  ensureAutoHide(): void {
    this._restartTimeout('_delayEnsureAutoHideId', GLib.timeout_add(GLib.PRIORITY_DEFAULT, DOCK_VISIBILITY_ANIMATION_TIME, () => {
      this._onHover();
      this._delayEnsureAutoHideId = 0;
      return GLib.SOURCE_REMOVE;
    }));
  }

  override show(animate = true, onComplete?: () => void): void {
    if (this._shown()) {
      onComplete?.();
      return;
    }

    super.show();
    const [validY, correctionOffset] = this._isValidY();
    if (!validY) {
      this.y += correctionOffset;
    }

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
      duration: DOCK_VISIBILITY_ANIMATION_TIME,
      mode: Clutter.AnimationMode.EASE_IN_CUBIC,
      onComplete,
    });

    this.ease_property('translation-y', 0, {
      duration: DOCK_VISIBILITY_ANIMATION_TIME * MINIMUM_PROPERTY_EASE_DURATION_FACTOR,
      mode: Clutter.AnimationMode.LINEAR,
    });
  }

  override hide(animate = true): void {
    if (this._hidden()) {
      return;
    }

    this.remove_all_transitions();
    this.set_pivot_point(0.5, 1);

    if (!animate) {
      this.translation_y = this.height;
      this.opacity = 0;
      this.set_scale(DOCK_HIDE_SCALE, DOCK_HIDE_SCALE);
      super.hide();
      return;
    }

    this.ease({
      opacity: 0,
      scale_x: DOCK_HIDE_SCALE,
      scale_y: DOCK_HIDE_SCALE,
      duration: DOCK_VISIBILITY_ANIMATION_TIME * MINIMUM_PROPERTY_EASE_DURATION_FACTOR,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      onComplete: () => super.hide(),
    });

    this.ease_property('translation-y', this.height, {
      duration: DOCK_VISIBILITY_ANIMATION_TIME,
      mode: Clutter.AnimationMode.LINEAR,
    });
  }

  private _redisplay(): void {
    const dashAny = this as any;
    const oldIconSize = dashAny.iconSize;
    Dash.prototype._redisplay.call(this);
    if (dashAny.iconSize !== oldIconSize) {
      this._reposition();
    }
  }

  private _reposition(): void {
    if (!this._workArea) {
      return;
    }
    const dashAny = this as any;
    const iconChildren = dashAny._box
      ?.get_children?.()
      ?.filter((actor: any) => actor.child && actor.child._delegate?.icon && !actor.animatingOut) ?? [];
    if (dashAny._showAppsIcon) {
      iconChildren.push(dashAny._showAppsIcon);
    }
    const showing = this.visible && this.opacity > 0;
    for (const child of iconChildren) {
      const icon = child.child._delegate.icon;
      icon.setIconSize(dashAny.iconSize);
      const [targetWidth, targetHeight] = icon.icon.get_size();
      if (!showing) {
        icon.icon.set_size(targetWidth, targetHeight);
        continue;
      }
      const heightId = icon.icon.connect('notify::allocation', () => {
        if (this._workArea) {
          this.applyWorkArea(this._workArea);
        }
      });
      icon.icon.ease({
        width: targetWidth,
        height: targetHeight,
        duration: DOCK_ANIMATION_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => icon.icon.disconnect(heightId),
      });
    }
    if (dashAny._separator) {
      dashAny._separator.ease({
        height: dashAny.iconSize,
        duration: DOCK_ANIMATION_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }
  }

  private _onHover(): void {
    this._clearTimeout('_autohideTimeoutId');
    this._autohideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DOCK_AUTOHIDE_TIMEOUT, () => {
      const dashContainer = (this as any)._dashContainer as St.Widget | undefined;
      if (dashContainer?.get_hover?.()) {
        return GLib.SOURCE_CONTINUE;
      }
      if (this._draggingItem || this._menuOpened || this._blockAutoHide) {
        return GLib.SOURCE_CONTINUE;
      }
      this.hide(true);
      this._autohideTimeoutId = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  private _ensureHoverState(): void {
    this._restartTimeout('_blockAutoHideDelayId', GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      const dashContainer = (this as any)._dashContainer as St.Widget | undefined;
      if (dashContainer?.get_hover?.()) {
        this.show(false);
      }
      this._blockAutoHideDelayId = 0;
      return GLib.SOURCE_REMOVE;
    }));
  }

  private _shown(): boolean {
    return this.visible && this.translation_y === 0 && this.scale_x === 1 && this.scale_y === 1 && this.opacity === 255;
  }

  private _hidden(): boolean {
    return !this.visible && this.translation_y === this.height && this.scale_x === DOCK_HIDE_SCALE && this.scale_y === DOCK_HIDE_SCALE && this.opacity === 0;
  }

  private _isValidY(): [boolean, number] {
    if (!this._workArea || !this._dashBounds) {
      return [true, 0];
    }
    const dockBottom = this._dashBounds.y + this._dashBounds.height;
    const workAreaBottom = this._workArea.y + this._workArea.height;
    if (dockBottom !== workAreaBottom) {
      return [false, workAreaBottom - dockBottom];
    }
    return [true, 0];
  }

  private _clearTimeout(property: '_autohideTimeoutId' | '_delayEnsureAutoHideId' | '_blockAutoHideDelayId'): void {
    const id = this[property];
    if (id) {
      GLib.source_remove(id);
      this[property] = 0;
    }
  }

  private _restartTimeout(property: '_blockAutoHideDelayId' | '_delayEnsureAutoHideId', id: number): void {
    this._clearTimeout(property);
    this[property] = id;
  }
  private _updateTargetBox(bounds: DashBounds): void {
    const padded: DashBounds = {
      x: bounds.x - LAYOUT_TARGET_BOX_PADDING,
      y: bounds.y - LAYOUT_TARGET_BOX_PADDING,
      width: bounds.width + LAYOUT_TARGET_BOX_PADDING * 2,
      height: bounds.height + LAYOUT_TARGET_BOX_PADDING * 2,
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

    const allocation = this.get_allocation_box?.();
    if (!allocation) {
      return;
    }

    const width = Math.max(0, (allocation.x2 ?? 0) - (allocation.x1 ?? 0));
    const height = Math.max(0, (allocation.y2 ?? 0) - (allocation.y1 ?? 0));
    if (width === 0 || height === 0) {
      return;
    }

    const [stageX, stageY] = (this as any).get_transformed_position?.() ?? [0, 0];

    const dashBounds: DashBounds = { x: stageX, y: stageY, width, height };
    this._dashBounds = dashBounds;
    this._updateTargetBox(dashBounds);
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

}


export type AuroraDashInstance = InstanceType<typeof AuroraDash>;
export type AuroraDashActor = AuroraDashInstance & Clutter.Actor;
