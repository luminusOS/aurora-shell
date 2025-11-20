
import '@girs/gjs';

import { Extension, gettext as _ } from "@girs/gnome-shell/extensions/extension";

import { ThemeChanger } from "./modules/themeChanger.ts";
import { Dock } from "./modules/dock.ts";
import type { Module } from "./modules/module.ts";

/**
 * Aurora Shell Extension
 * 
 * Main extension that orchestrates all modules.
 * Each module is independent and can be enabled/disabled separately.
 */
export default class AuroraShellExtension extends Extension {
  private _modules: Map<string, Module> = new Map();

  override enable(): void {
    console.log('Enabling extension');

    this._initializeModules();
    this._enableAllModules();
  }

  private _initializeModules(): void {
    this._modules.set('themeChanger', new ThemeChanger());
    this._modules.set('dock', new Dock());

    // Add more modules here as needed:
    // this._modules.set('moduleName', new ModuleName());
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

  override disable(): void {
    console.log('Aurora Shell: Disabling extension');

    for (const [name, module] of this._modules) {
      try {
        module.disable();
      } catch (e) {
        console.error(`Aurora Shell: Failed to disable module ${name}:`, e);
      }
    }

    this._modules.clear();
  }
}
