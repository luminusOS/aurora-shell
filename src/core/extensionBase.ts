import { Extension } from '@girs/gnome-shell/extensions/extension';

import type { ExtensionContext } from '~/core/context.ts';
import { DefaultExtensionContext } from '~/core/context.ts';
import { ConsoleLogger, logger, setGlobalLogger } from '~/core/logger.ts';
import { GSettingsManager } from '~/core/settings.ts';
import { DefaultDeviceService } from '~/device/device.ts';
import { ModuleManager } from '~/moduleManager.ts';
import type { Module } from '~/module.ts';
import { getModuleRegistry } from '~/registry.ts';
import { cleanupIcons, initIcons } from '~/shared/icons.ts';

const LOG_PREFIX = 'AuroraShell';

export class AuroraShellExtensionBase extends Extension {
  protected _manager: ModuleManager | null = null;
  protected _context: ExtensionContext | null = null;

  get _modules(): ReadonlyMap<string, Module> {
    return this._manager?.modules ?? new Map();
  }

  override enable(): void {
    const consoleLogger = new ConsoleLogger('Aurora Shell', this.uuid);
    setGlobalLogger(consoleLogger);
    consoleLogger.debug('Enabling extension', { prefix: LOG_PREFIX });

    const device = new DefaultDeviceService();
    this._context = new DefaultExtensionContext(
      this.uuid,
      this.path,
      new GSettingsManager(this.getSettings()),
      device,
    );

    initIcons(this.path);
    this._manager = new ModuleManager(getModuleRegistry(), this._context, {
      debug: (message) => logger.debug(message, { prefix: LOG_PREFIX }),
      error: (message) => logger.error(message, { prefix: LOG_PREFIX }),
    });
    this._manager.start();
  }

  override disable(): void {
    logger.debug('Disabling extension', { prefix: LOG_PREFIX });
    this._manager?.stop();
    this._manager = null;
    this._context?.device.destroy();
    this._context = null;
    cleanupIcons();
  }
}
