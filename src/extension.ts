import '@girs/gjs';

import type Gio from '@girs/gio-2.0';
import { Extension } from '@girs/gnome-shell/extensions/extension';

import type { Module } from './module.ts';
import { getModuleRegistry, type ModuleDefinition } from './registry.ts';
import type { ExtensionContext } from '~/core/context.ts';
import { DefaultExtensionContext } from '~/core/context.ts';
import { ConsoleLogger } from '~/core/logger.ts';
import { GSettingsManager } from '~/core/settings.ts';
import { GnomeShellAdapter } from '~/core/adapters/shell.ts';

/**
 * Aurora Shell Extension
 *
 * Main extension that orchestrates all modules.
 * Each module is independent and can be enabled/disabled separately.
 */
export default class AuroraShellExtension extends Extension {
  private _modules: Map<string, Module> = new Map();
  private _settings: Gio.Settings | null = null;
  private _context: ExtensionContext | null = null;

  override enable(): void {
    const logger = new ConsoleLogger('Aurora Shell', this.uuid);
    logger.log('Enabling extension');

    this._settings = this.getSettings();
    this._context = new DefaultExtensionContext(
      this.uuid,
      this.path,
      logger,
      new GSettingsManager(this._settings),
      new GnomeShellAdapter(),
    );

    this._initializeModules();
    this._enableAllModules();
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
        this._context!.logger.error(`Failed to enable module ${name}: ${e}`);
      }
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

    // @ts-ignore
    this._settings.connectObject(...args);
  }

  private _toggleModule(def: ModuleDefinition): void {
    const enabled = this._settings!.get_boolean(def.settingsKey);
    const existing = this._modules.get(def.key);

    if (enabled && !existing) {
      this._context!.logger.log(`Enabling module ${def.key}`);
      try {
        const module = def.factory(this._context!);
        module.enable();
        this._modules.set(def.key, module);
      } catch (e) {
        this._context!.logger.error(`Failed to enable module ${def.key}: ${e}`);
      }
    } else if (!enabled && existing) {
      this._context!.logger.log(`Disabling module ${def.key}`);
      try {
        existing.disable();
        this._modules.delete(def.key);
      } catch (e) {
        this._context!.logger.error(`Failed to disable module ${def.key}: ${e}`);
      }
    }
  }

  override disable(): void {
    this._context!.logger.log('Disabling extension');

    // @ts-ignore
    this._settings?.disconnectObject(this);

    for (const [name, module] of this._modules) {
      try {
        module.disable();
      } catch (e) {
        this._context!.logger.error(`Failed to disable module ${name}: ${e}`);
      }
    }

    this._modules.clear();
    this._settings = null;
    this._context = null;
  }
}
