import '@girs/gjs';

import GLib from '@girs/glib-2.0';
import { Extension } from '@girs/gnome-shell/extensions/extension';

import type { ExtensionContext } from '~/core/context.ts';
import { DefaultExtensionContext } from '~/core/context.ts';
import { ConsoleLogger, logger, setGlobalLogger } from '~/core/logger.ts';
import { GSettingsManager } from '~/core/settings.ts';
import { DefaultDeviceService } from '~/device/device.ts';
import { DevTool } from '~/dev/devTool.ts';
import { ModuleManager } from '~/moduleManager.ts';
import type { Module } from '~/module.ts';
import { getModuleRegistry } from '~/registry.ts';
import { cleanupIcons, initIcons } from '~/shared/icons.ts';

const LOG_PREFIX = 'AuroraShell';

export default class AuroraShellExtension extends Extension {
  private _manager: ModuleManager | null = null;
  private _devTool: DevTool | null = null;
  private _context: ExtensionContext | null = null;

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
    this._enableDevTool();
  }

  private _enableDevTool(): void {
    if (GLib.getenv('AURORA_DEVTOOLS') !== '1' || !this._context || !this._manager) return;

    try {
      this._devTool = new DevTool(this._context, {
        getModule: (key) => this._manager?.getModule(key) ?? null,
        openPreferences: () => this.openPreferences(),
      });
      this._devTool.enable();
    } catch (error) {
      logger.error(`Failed to enable DevTool: ${String(error)}`, { prefix: LOG_PREFIX });
      this._devTool = null;
    }
  }

  private _disableDevTool(): void {
    if (!this._devTool) return;
    try {
      this._devTool.disable();
    } catch (error) {
      logger.error(`Failed to disable DevTool: ${String(error)}`, { prefix: LOG_PREFIX });
    } finally {
      this._devTool = null;
    }
  }

  override disable(): void {
    logger.debug('Disabling extension', { prefix: LOG_PREFIX });
    this._disableDevTool();
    this._manager?.stop();
    this._manager = null;
    this._context?.device.destroy();
    this._context = null;
    cleanupIcons();
  }
}
