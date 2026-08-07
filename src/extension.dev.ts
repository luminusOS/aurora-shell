import '@girs/gjs';

import GLib from '@girs/glib-2.0';
import { Extension } from '@girs/gnome-shell/extensions/extension';

import { logger } from '~/core/logger.ts';
import { ShellRuntime } from '~/core/shellRuntime.ts';
import { DevTool } from '~/dev/devTool.ts';

const LOG_PREFIX = 'AuroraShell';

export default class AuroraShellDevelopmentExtension extends Extension {
  private _runtime: ShellRuntime | null = null;
  private _devTool: DevTool | null = null;

  override enable(): void {
    const runtime = new ShellRuntime(this);
    this._runtime = runtime;
    runtime.start();

    const context = runtime.context;
    if (GLib.getenv('AURORA_DEVTOOLS') !== '1' || !context) return;

    try {
      this._devTool = new DevTool(context, {
        getModule: (key) => runtime.getModule(key),
        openPreferences: () => this.openPreferences(),
      });
      this._devTool.enable();
    } catch (error) {
      const devTool = this._devTool;
      this._devTool = null;

      if (devTool) devTool.disable();

      logger.error(`Failed to enable DevTool: ${String(error)}`, { prefix: LOG_PREFIX });
    }
  }

  override disable(): void {
    const devTool = this._devTool;
    this._devTool = null;

    if (devTool) devTool.disable();

    this._runtime?.stop();
    this._runtime = null;
  }
}
