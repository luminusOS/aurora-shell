import * as Main from '@girs/gnome-shell/ui/main';

import { Module } from '../module.ts';

/**
 * NoOverview Module
 * 
 * Automatically hides the GNOME Overview on startup.
 * This provides a cleaner desktop experience for users who prefer not to use the overview.
 * Note: This module only hides the overview on startup. Users can still access it via hotkeys or gestures.
 */
export class NoOverview extends Module {
  override enable(): void {
    Main.layoutManager.connectObject(
      'startup-complete', () => Main.overview.hide(),
      this
    );
  }

  override disable(): void {
    Main.layoutManager.disconnectObject(this);
  }
}
