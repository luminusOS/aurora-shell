// Small press-state machine for dock icon click feedback, ported from
// d2d-companion's lib/motion/pressInteraction.js. The source project's
// PressMode.LAUNCHES_ONLY is driven by its launch engine (not ported here);
// this version decides "is this a launch click" itself via a caller-supplied
// flag instead (see IconMotionController).

import { PressMode, type PressRecipe } from '~/dock/motion/catalog.ts';

export class PressInteraction {
  private _pressed = false;
  private _active = false;

  get pressed(): boolean {
    return this._pressed;
  }

  // Call on the primary button-press-event. `isLaunchClick` should reflect
  // whether this click is expected to start a new app instance.
  beginPrimary(config: PressRecipe, isLaunchClick: boolean): boolean {
    this._active = Boolean(
      config.enabled &&
      (config.mode === PressMode.ALL_PRIMARY_CLICKS ||
        (config.mode === PressMode.LAUNCHES_ONLY && isLaunchClick)),
    );
    return this._applyStep(this._active);
  }

  // Call on notify::pressed; clears an early visual press if the pointer
  // was dragged off the icon before release.
  syncButtonPressed(buttonPressed: boolean): boolean {
    if (buttonPressed || !this._active) return false;
    return this._applyStep(false);
  }

  finishClick(): boolean {
    this._active = false;
    return this._applyStep(false);
  }

  reset(): boolean {
    this._active = false;
    return this._applyStep(false);
  }

  private _applyStep(pressed: boolean): boolean {
    if (this._pressed === pressed) return false;
    this._pressed = pressed;
    return true;
  }
}
