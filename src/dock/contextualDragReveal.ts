import GLib from '@girs/glib-2.0';
import * as DND from '@girs/gnome-shell/ui/dnd';
import * as Main from '@girs/gnome-shell/ui/main';

import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import { logger } from '~/core/logger.ts';

const REVEAL_DELAY = 800;
const LOG_PREFIX = 'Dock';

export type ContextualDragTarget = {
  monitorIndex: number;
  hotArea: { canStartContextualDragReveal(x: number, y: number): boolean } | null;
  dash: { canAcceptContextualEdgeDrag(source: unknown): boolean };
};

export class ContextualDragRevealCoordinator<T extends ContextualDragTarget> {
  private _scope = new LifecycleScope();
  private _timer: ManagedSource = createManagedSource(this._scope);
  private _target: T | null = null;
  private _monitor: { dragMotion: (event: any) => number };

  constructor(
    private _targets: () => Iterable<T>,
    private _isCurrent: (target: T) => boolean,
    private _reveal: (target: T) => void,
  ) {
    this._monitor = {
      dragMotion: (event) => {
        this._handleMotion(event);
        return DND.DragMotionResult.CONTINUE;
      },
    };
    DND.addDragMonitor(this._monitor);
    Main.xdndHandler.connectObject('drag-end', () => this.clear(), this);
    Main.overview.connectObject(
      'item-drag-end',
      () => this.clear(),
      'item-drag-cancelled',
      () => this.clear(),
      'window-drag-end',
      () => this.clear(),
      'window-drag-cancelled',
      () => this.clear(),
      this,
    );
  }

  clearTarget(target: T): void {
    if (this._target === target) {
      this.clear();
    }
  }

  clear(): void {
    this._timer.clear();
    this._target = null;
  }

  destroy(): void {
    this.clear();
    DND.removeDragMonitor(this._monitor);
    Main.xdndHandler.disconnectObject(this);
    Main.overview.disconnectObject(this);
    this._scope.dispose();
  }

  private _handleMotion({ source, x, y }: any): void {
    let target: T | null = null;
    for (const candidate of this._targets()) {
      if (
        candidate.hotArea?.canStartContextualDragReveal(x, y) &&
        candidate.dash.canAcceptContextualEdgeDrag(source)
      ) {
        target = candidate;
        break;
      }
    }
    if (target === this._target) return;

    this.clear();
    if (!target) return;

    this._target = target;
    this._timer.replace(() =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, REVEAL_DELAY, () => {
        this._timer.complete();
        const current = this._target;
        this._target = null;

        if (
          current &&
          this._isCurrent(current) &&
          current.hotArea?.canStartContextualDragReveal(x, y) &&
          current.dash.canAcceptContextualEdgeDrag(source)
        ) {
          logger.debug(
            `monitor=${current.monitorIndex} contextual drag reveal after ${REVEAL_DELAY}ms`,
            { prefix: LOG_PREFIX },
          );
          this._reveal(current);
        }

        return GLib.SOURCE_REMOVE;
      }),
    );
  }
}
