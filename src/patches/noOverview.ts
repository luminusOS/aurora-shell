import { gettext as _ } from 'gettext';

import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';

/**
 * NoOverview Module
 *
 * Prevents the GNOME Overview from showing at startup by temporarily disabling
 * `sessionMode.hasOverview`, which causes the startup animation to skip the
 * overview transition entirely. Once startup completes, `hasOverview` is restored
 * so the overview remains accessible via hotkeys, gestures, and the Activities button.
 */
export class NoOverview extends Module {
  private _startupId: number | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    if (!Main.layoutManager._startingUp) return;

    Main.sessionMode.hasOverview = false;

    this._startupId = Main.layoutManager.connect('startup-complete', () => {
      Main.sessionMode.hasOverview = true;
      Main.overview.hide();
      this._startupId = null;
    });
  }

  override disable(): void {
    Main.sessionMode.hasOverview = true;
    if (this._startupId !== null) {
      Main.layoutManager.disconnect(this._startupId);
      this._startupId = null;
    }
  }
}

export const definition: ModuleDefinition = {
  key: 'no-overview',
  settingsKey: 'module-no-overview',
  section: 'behavior',
  title: _('No Overview'),
  subtitle: _('Disables the overview at startup'),
  factory: (ctx) => new NoOverview(ctx),
};
