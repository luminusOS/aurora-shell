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
    if (GLib.getenv('AURORA_DEVTOOLS') !== '1' || !this._context || !this._manager) return;

    try {
      this._devTool = new DevTool(this._context, {
        getModule: (key) => this._manager?.getModule(key) ?? null,
        openPreferences: () => this.openPreferences(),
      });
      this._devTool.enable();
    } catch (error) {
      this._devTool?.disable();
      this._devTool = null;
      logger.error(`Failed to enable DevTool: ${String(error)}`, { prefix: LOG_PREFIX });
    }
  }

  override disable(): void {
    try {
      this._devTool?.disable();
    } catch (error) {
      logger.error(`Failed to disable DevTool: ${String(error)}`, { prefix: LOG_PREFIX });
    }
    this._devTool = null;
    super.disable();
  }
}
