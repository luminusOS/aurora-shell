import Clutter from '@girs/clutter-18';
import GLib from '@girs/glib-2.0';
import * as DND from '@girs/gnome-shell/ui/dnd';
import * as Main from '@girs/gnome-shell/ui/main';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';

const SPRING_LOAD_DELAY = 400;

export class DashSpringLoadCoordinator {
  private _scope = new LifecycleScope();
  private _timer: ManagedSource = createManagedSource(this._scope);
  private _target: any = null;
  private _monitor: { dragMotion: (event: any) => number };

  constructor(
    private _getBox: () => any,
    private _isWindowRelevant: (window: any) => boolean,
  ) {
    this._monitor = {
      dragMotion: (event) => this._handleMotion(event),
    };

    DND.addDragMonitor(this._monitor);
    (global.backend as any).get_dnd().connectObject('dnd-leave', () => this.clear(), this);
  }

  clear(): void {
    this._target?.remove_style_class_name('aurora-drag-hover');
    this._timer.clear();
    this._target = null;
  }

  destroy(): void {
    this.clear();
    this._scope.dispose();
    DND.removeDragMonitor(this._monitor);
    (global.backend as any).get_dnd().disconnectObject(this);
  }

  private _handleMotion(event: any): number {
    if (event.source?.app) {
      this.clear();
      return DND.DragMotionResult.CONTINUE;
    }

    const target = this._findTarget(event.x, event.y);
    if (target === this._target) return DND.DragMotionResult.CONTINUE;

    this.clear();
    this._target = target;

    const app = target?.child?._delegate?.app;
    if (!app) return DND.DragMotionResult.CONTINUE;

    target.add_style_class_name('aurora-drag-hover');
    this._timer.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, SPRING_LOAD_DELAY, () => {
        this._timer.complete();

        const windows = app.get_windows().filter(this._isWindowRelevant);
        const window = windows[0];
        if (window) {
          if (window.minimized) window.unminimize();
          Main.activateWindow(window);
        }

        return GLib.SOURCE_REMOVE;
      }),
    );

    return DND.DragMotionResult.CONTINUE;
  }

  private _findTarget(x: number, y: number): any | null {
    const box = this._getBox();
    let actor: Clutter.Actor | null = global.stage.get_actor_at_pos(
      Clutter.PickMode.REACTIVE,
      x,
      y,
    );

    while (actor) {
      if (actor.get_parent() === box) return actor;
      actor = actor.get_parent();
    }

    return null;
  }
}
