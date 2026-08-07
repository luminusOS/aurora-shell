import '@girs/gjs';

import { Extension } from '@girs/gnome-shell/extensions/extension';

import { ShellRuntime } from '~/core/shellRuntime.ts';

export default class AuroraShellExtension extends Extension {
  private _runtime: ShellRuntime | null = null;

  override enable(): void {
    this._runtime = new ShellRuntime(this);
    this._runtime.start();
  }

  override disable(): void {
    this._runtime?.stop();
    this._runtime = null;
  }
}
