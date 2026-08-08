import '@girs/gjs';

import Clutter from '@girs/clutter-18';
import GLib from '@girs/glib-2.0';
import GObject from '@girs/gobject-2.0';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';

export const TrayClipArea = GObject.registerClass(
  class TrayClipArea extends Clutter.Actor {
    public fullWidth = 0;
    public reservedWidth = 0;
    private _childOffsetX = 0;
    private _viewportWidth = 0;
    private _clipStart = 0;
    declare private _lifecycle: LifecycleScope;
    declare private _viewportTimeout: ManagedSource;

    override _init(params = {}) {
      super._init({ clip_to_allocation: false, x_expand: false, y_expand: true, ...params });
      this._lifecycle = new LifecycleScope();
      this._viewportTimeout = createManagedSource(this._lifecycle);
    }

    override vfunc_allocate(box: Clutter.ActorBox): void {
      super.vfunc_allocate(box);
      const childBox = new Clutter.ActorBox();
      childBox.set_origin(Math.round(this._childOffsetX), 0);
      childBox.set_size(Math.round(this.fullWidth), Math.round(box.y2 - box.y1));
      this._syncClip();
      for (const child of this.get_children()) {
        child.allocate(childBox);
      }
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
      const startUs = GLib.get_monotonic_time();
      const durationUs = durationMs * 1000;

      this._viewportTimeout.replace(() =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
          const progress = Math.min(1, (GLib.get_monotonic_time() - startUs) / durationUs);
          const eased = 1 - Math.pow(1 - progress, 3);
          this._viewportWidth = fromViewportWidth + (toViewportWidth - fromViewportWidth) * eased;
          this._clipStart = fromClipStart + (toClipStart - fromClipStart) * eased;
          this._syncClip();
          onFrame(this._viewportWidth, this._clipStart);
          if (progress < 1) return GLib.SOURCE_CONTINUE;

          this._viewportTimeout.complete();
          this._viewportWidth = toViewportWidth;
          this._clipStart = toClipStart;
          this._syncClip();
          onFrame(toViewportWidth, toClipStart);
          onComplete();
          return GLib.SOURCE_REMOVE;
        }),
      );
    }

    cancelViewportAnimation(): void {
      this._viewportTimeout.clear();
    }

    get viewportWidth(): number {
      return this._viewportWidth;
    }

    get clipStart(): number {
      return this._clipStart;
    }

    layoutSnapshot(): string {
      const child = this.get_first_child();
      return [
        `reservedWidth=${Math.round(this.reservedWidth)}`,
        `actorWidth=${Math.round(this.width)}`,
        `viewportWidth=${Math.round(this._viewportWidth)}`,
        `clipStart=${Math.round(this._clipStart)}`,
        `allocated=${Math.round(this.allocation.x2 - this.allocation.x1)}`,
        `fullWidth=${Math.round(this.fullWidth)}`,
        `childOffsetX=${Math.round(this._childOffsetX)}`,
        `childX=${child ? Math.round(child.x) : 'none'}`,
        `childWidth=${child ? Math.round(child.width) : 'none'}`,
      ].join(' ');
    }

    override destroy(): void {
      this._lifecycle.dispose();
      super.destroy();
    }

    private _syncClip(): void {
      const reservedWidth = Math.round(this.reservedWidth);
      const clipStart = Math.min(reservedWidth, Math.max(0, Math.round(this._clipStart)));
      const visibleWidth = Math.min(
        reservedWidth - clipStart,
        Math.max(0, Math.round(this._viewportWidth)),
      );
      this.set_clip(clipStart, 0, visibleWidth, Math.max(0, Math.round(this.height)));
    }
  },
);

export type TrayClipArea = InstanceType<typeof TrayClipArea>;
