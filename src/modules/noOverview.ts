import type { ExtensionContext } from "~/core/context.ts";
import { Module } from '~/module.ts';

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
    if (!this.context.shell.isStartingUp) return;

    this.context.shell.hasOverview = false;

    this._startupId = this.context.shell.onStartupComplete(() => {
      this.context.shell.hasOverview = true;
      this.context.shell.hideOverview();
      this._startupId = null;
    });
  }

  override disable(): void {
    this.context.shell.hasOverview = true;
    if (this._startupId !== null) {
      this.context.shell.disconnect(this._startupId);
      this._startupId = null;
    }
  }
}
