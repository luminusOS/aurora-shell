
import '@girs/gjs';

import Gio from "@girs/gio-2.0";
import { Extension } from "@girs/gnome-shell/extensions/extension";

import type { Module } from "./module.ts";
import { MODULE_REGISTRY, type ModuleDefinition } from "./registry.ts";

import { ThemeChanger } from "./modules/themeChanger.ts";
import { Dock } from "./modules/dock/index.ts";
import { NoOverview } from "./modules/noOverview.ts";
import { PipOnTop } from "./modules/pipOnTop.ts";

const MODULE_FACTORIES: Record<string, () => Module> = {
  themeChanger: () => new ThemeChanger(),
  dock: () => new Dock(),
  noOverview: () => new NoOverview(),
  pipOnTop: () => new PipOnTop(),
};

/**
 * Aurora Shell Extension
 *
 * Main extension that orchestrates all modules.
 * Each module is independent and can be enabled/disabled separately.
 */
export default class AuroraShellExtension extends Extension {
  private _modules: Map<string, Module> = new Map();
  private _settings: Gio.Settings | null = null;

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
        this._modules.set(def.key, MODULE_FACTORIES[def.key]());
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

    const args: any[] = [];
    for (const def of MODULE_REGISTRY) {
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
      console.log(`Aurora Shell: Enabling module ${def.key}`);
      try {
        const module = MODULE_FACTORIES[def.key]();
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

    this._settings?.disconnectObject(this);

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
