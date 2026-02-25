import * as Main from '@girs/gnome-shell/ui/main';

import { Module } from '../module.ts';

/**
 * NoOverview Module
 *
 * Prevents the GNOME Overview from showing at startup by temporarily disabling
 * `sessionMode.hasOverview`, which causes the startup animation to skip the
 * overview transition entirely. Once startup completes, `hasOverview` is restored
 * so the overview remains accessible via hotkeys, gestures, and the Activities button.
 */
export class NoOverview extends Module {
  override enable(): void {
    if (!Main.layoutManager._startingUp) return;

    Main.sessionMode.hasOverview = false;

    // @ts-ignore
    Main.layoutManager.connectObject(
      'startup-complete', () => {
        Main.sessionMode.hasOverview = true;
        Main.overview.hide();
      },
      this
    );
  }

  override disable(): void {
    Main.sessionMode.hasOverview = true;
    // @ts-ignore
    Main.layoutManager.disconnectObject(this);
  }
}
