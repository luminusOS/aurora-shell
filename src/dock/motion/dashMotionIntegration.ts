// Attaches dock icon hover/press motion to an AuroraDash, replacing
// d2d-companion's lib/runtime/dashIntegration.js. aurora-shell always has
// exactly one AuroraDash target per binding (no "is this a dock or the
// stock overview dash" guard needed, unlike the source project).

import type St from '@girs/st-18';

import type { MotionRecipe } from '~/dock/motion/catalog.ts';
import type { DockPosition } from '~/dock/dockConfiguration.ts';
import { MotionSurface } from '~/dock/motion/motionSurface.ts';
import type { AuroraDash } from '~/shared/ui/dash.ts';

export class DashMotionIntegration {
  private _dash: AuroraDash | null = null;
  private _box: St.Widget | null = null;
  private _savedClip = false;
  private _surface: MotionSurface | null = null;
  private _recipe: MotionRecipe;

  constructor(
    recipe: MotionRecipe,
    private _position: DockPosition,
  ) {
    this._recipe = recipe;
  }

  attach(dash: AuroraDash, enabled: boolean): void {
    this._dash = dash;
    if (enabled) this._start();
  }

  setEnabled(enabled: boolean): void {
    if (enabled) this._start();
    else this._stop();
  }

  setRecipe(recipe: MotionRecipe): void {
    this._recipe = recipe;
    this._surface?.setRecipe(recipe);
  }

  dispose(): void {
    this._stop();
    this._dash = null;
  }

  private _start(): void {
    if (this._surface || !this._dash) return;
    const box = this._dash._box;
    const dashContainer = this._dash._dashContainer;
    if (!box) return;

    this._box = box;
    // The dash clips icons to their row; hover motion needs to overflow it.
    this._savedClip = box.clip_to_allocation;
    box.clip_to_allocation = false;

    this._surface = new MotionSurface({
      recipe: this._recipe,
      position: this._position,
      getOrderedContainers: () => {
        if (!dashContainer) return box.get_children();
        return dashContainer
          .get_children()
          .flatMap((container) => (container === box ? box.get_children() : [container]));
      },
    });
    this._surface.addContainerSource(box);
    if (dashContainer && dashContainer !== box) this._surface.addContainerSource(dashContainer);
  }

  private _stop(): void {
    if (!this._surface) return;
    this._surface.dispose();
    this._surface = null;
    if (this._box) this._box.clip_to_allocation = this._savedClip;
    this._box = null;
  }
}
