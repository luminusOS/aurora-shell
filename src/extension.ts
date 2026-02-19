
import '@girs/gjs';

import Gio from "@girs/gio-2.0";
import { Extension } from "@girs/gnome-shell/extensions/extension";

import type { Module } from "./module.ts";
import { MODULE_REGISTRY, type ModuleDefinition } from "./registry.ts";

/**
 * Aurora Shell Extension
 *
 * Main extension that orchestrates all modules.
 * Each module is independent and can be enabled/disabled separately.
 */
export default class AuroraShellExtension extends Extension {
  private _modules: Map<string, Module> = new Map();
  private _settings: Gio.Settings | null = null;
  private _settingsHandlers: number[] = [];

  override enable(): void {
    console.log('Enabling extension');

    this._settings = this.getSettings();
    this._initializeModules();
    this._enableAllModules();
    this._connectSettings();
  }

  private _initializeModules(): void {
    for (const def of MODULE_REGISTRY) {
      if (this._settings?.get_boolean(def.settingsKey)) {
        this._modules.set(def.key, def.create());
      }
    }
  }

  private _enableAllModules(): void {
    for (const [name, module] of this._modules) {
      try {
        module.enable();
      } catch (e) {
        console.error(`Aurora Shell: Failed to enable module ${name}:`, e);
      }
    }
  }

  private _connectSettings(): void {
    if (!this._settings) return;

    for (const def of MODULE_REGISTRY) {
      const handlerId = this._settings.connect(`changed::${def.settingsKey}`, () => {
        this._toggleModule(def);
      });
      this._settingsHandlers.push(handlerId);
    }
  }

  private _toggleModule(def: ModuleDefinition): void {
    const enabled = this._settings!.get_boolean(def.settingsKey);
    const existing = this._modules.get(def.key);

    if (enabled && !existing) {
      console.log(`Aurora Shell: Enabling module ${def.key}`);
      try {
        const module = def.create();
        module.enable();
        this._modules.set(def.key, module);
      } catch (e) {
        console.error(`Aurora Shell: Failed to enable module ${def.key}:`, e);
      }
    } else if (!enabled && existing) {
      console.log(`Aurora Shell: Disabling module ${def.key}`);
      try {
        existing.disable();
        this._modules.delete(def.key);
      } catch (e) {
        console.error(`Aurora Shell: Failed to disable module ${def.key}:`, e);
      }
    }
  }

  override disable(): void {
    console.log('Aurora Shell: Disabling extension');

    if (this._settings) {
      for (const handlerId of this._settingsHandlers) {
        this._settings.disconnect(handlerId);
      }
      this._settingsHandlers = [];
    }

    for (const [name, module] of this._modules) {
      try {
        module.disable();
      } catch (e) {
        console.error(`Aurora Shell: Failed to disable module ${name}:`, e);
      }
    }

    this._modules.clear();
    this._settings = null;
  }
}
