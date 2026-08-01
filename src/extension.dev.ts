import '@girs/gjs';

import GLib from '@girs/glib-2.0';

import { AuroraShellExtensionBase } from '~/core/extensionBase.ts';
import { logger } from '~/core/logger.ts';
import { DevTool } from '~/dev/devTool.ts';

const LOG_PREFIX = 'AuroraShell';

export default class AuroraShellDevelopmentExtension extends AuroraShellExtensionBase {
  private _devTool: DevTool | null = null;

  override enable(): void {
    super.enable();
    const context = this._context;
    const manager = this._manager;
    if (GLib.getenv('AURORA_DEVTOOLS') !== '1' || !context || !manager) return;

    try {
      this._devTool = new DevTool(context, {
        getModule: (key) => manager.getModule(key),
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

    super.disable();
  }
}
