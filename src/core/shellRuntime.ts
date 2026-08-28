import type { Extension } from '@girs/gnome-shell/extensions/extension';

import type { ExtensionContext } from '~/core/context.ts';
import { DefaultExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { GSettingsManager } from '~/core/settings.ts';
import { DefaultDeviceService } from '~/device/device.ts';
import { ModuleManager } from '~/moduleManager.ts';
import type { Module } from '~/module.ts';
import { getModuleRegistry } from '~/registry.ts';
import { cleanupIcons, initIcons } from '~/shared/icons.ts';

const LOG_PREFIX = 'AuroraShell';

/**
 * Owns every resource the extension allocates while enabled.
 *
 * The entry points create one runtime in `enable()` and drop it in `disable()`,
 * so `start()` and `stop()` stay a symmetric pair.
 */
export class ShellRuntime {
  private _manager: ModuleManager | null = null;
  private _context: ExtensionContext | null = null;

  constructor(private readonly _extension: Extension) {}

  get context(): ExtensionContext | null {
    return this._context;
  }

  getModule(key: string): Module | null {
    if (!this._manager) return null;

    return this._manager.getModule(key);
  }

  start(): void {
    const extension = this._extension;
    logger.debug('Enabling extension', { prefix: LOG_PREFIX });

    const device = new DefaultDeviceService();
    this._context = new DefaultExtensionContext(
      extension.uuid,
      extension.path,
      new GSettingsManager(extension.getSettings()),
      device,
    );

    initIcons(extension.path);
    this._manager = new ModuleManager(getModuleRegistry(), this._context, {
      debug: (message) => logger.debug(message, { prefix: LOG_PREFIX }),
      error: (message) => logger.error(message, { prefix: LOG_PREFIX }),
    });
    this._manager.start();
  }

  stop(): void {
    logger.debug('Disabling extension', { prefix: LOG_PREFIX });
    this._manager?.stop();
    this._manager = null;
    this._context?.device.destroy();
    this._context = null;
    cleanupIcons();
  }
}
