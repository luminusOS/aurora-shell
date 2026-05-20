import '@girs/gjs';

import type Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Extension } from '@girs/gnome-shell/extensions/extension';

import type { Module } from './module.ts';
import { getModuleRegistry, type ModuleDefinition } from './registry.ts';
import type { ExtensionContext } from '~/core/context.ts';
import { initIcons, cleanupIcons } from '~/shared/icons.ts';
import { DefaultExtensionContext } from '~/core/context.ts';
import { ConsoleLogger, setGlobalLogger, logger } from '~/core/logger.ts';
import { GSettingsManager } from '~/core/settings.ts';
import { GnomeShellAdapter } from '~/core/adapters/shell.ts';
import { DevTool } from '~/modules/devTool/devTool.ts';

const LOG_PREFIX = 'AuroraShell';

/**
 * Aurora Shell Extension
 *
 * Main extension that orchestrates all modules.
 * Each module is independent and can be enabled/disabled separately.
 */
export default class AuroraShellExtension extends Extension {
  private _modules: Map<string, Module> = new Map();
  private _devTool: DevTool | null = null;
  private _settings: Gio.Settings | null = null;
  private _context: ExtensionContext | null = null;

  override enable(): void {
    const consoleLogger = new ConsoleLogger('Aurora Shell', this.uuid);
    setGlobalLogger(consoleLogger);
    consoleLogger.log('Enabling extension', { prefix: LOG_PREFIX });

    this._settings = this.getSettings();
    this._context = new DefaultExtensionContext(
      this.uuid,
      this.path,
      new GSettingsManager(this._settings),
      new GnomeShellAdapter(),
    );

    initIcons(this.path);
    this._initializeModules();
    this._enableAllModules();
    this._enableDevTool();
    this._connectSettings();
  }

  private _initializeModules(): void {
    for (const def of getModuleRegistry()) {
      if (this._settings?.get_boolean(def.settingsKey)) {
        this._modules.set(def.key, def.factory(this._context!));
      }
    }
  }

  private _enableAllModules(): void {
    for (const [name, module] of this._modules) {
      try {
        module.enable();
      } catch (e) {
        logger.error(`Failed to enable module ${name}: ${e}`, { prefix: LOG_PREFIX });
      }
    }
  }

  private _enableDevTool(): void {
    if (GLib.getenv('AURORA_DEVTOOLS') !== '1' || !this._context) return;

    try {
      this._devTool = new DevTool(this._context);
      this._devTool.enable();
    } catch (e) {
      logger.error(`Failed to enable DevTool: ${e}`, { prefix: LOG_PREFIX });
      this._devTool = null;
    }
  }

  private _disableDevTool(): void {
    if (!this._devTool) return;

    try {
      this._devTool.disable();
    } catch (e) {
      logger.error(`Failed to disable DevTool: ${e}`, { prefix: LOG_PREFIX });
    } finally {
      this._devTool = null;
    }
  }

  private _connectSettings(): void {
    if (!this._settings) return;

    const args: any[] = [];
    for (const def of getModuleRegistry()) {
      args.push(`changed::${def.settingsKey}`, () => {
        this._toggleModule(def);
      });
    }
    args.push(this);

    this._settings.connectObject(...args);
  }

  private _toggleModule(def: ModuleDefinition): void {
    const enabled = this._settings!.get_boolean(def.settingsKey);
    const existing = this._modules.get(def.key);

    if (enabled && !existing) {
      logger.log(`Enabling module ${def.key}`, { prefix: LOG_PREFIX });
      try {
        const module = def.factory(this._context!);
        module.enable();
        this._modules.set(def.key, module);
      } catch (e) {
        logger.error(`Failed to enable module ${def.key}: ${e}`, { prefix: LOG_PREFIX });
      }
    } else if (!enabled && existing) {
      logger.log(`Disabling module ${def.key}`, { prefix: LOG_PREFIX });
      try {
        existing.disable();
        this._modules.delete(def.key);
      } catch (e) {
        logger.error(`Failed to disable module ${def.key}: ${e}`, { prefix: LOG_PREFIX });
      }
    }
  }

  override disable(): void {
    logger.log('Disabling extension', { prefix: LOG_PREFIX });

    this._settings?.disconnectObject(this);
    this._disableDevTool();

    for (const [name, module] of this._modules) {
      try {
        module.disable();
      } catch (e) {
        logger.error(`Failed to disable module ${name}: ${e}`, { prefix: LOG_PREFIX });
      }
    }

    this._modules.clear();
    this._settings = null;
    this._context = null;
    cleanupIcons();
  }
}
