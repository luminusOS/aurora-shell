
import '@girs/gjs';

import { Extension, gettext as _, type ConsoleLike } from "@girs/gnome-shell/extensions/extension";

import { ThemeChanger } from "./modules/themeChanger.ts";
import { SmartDock } from "./modules/smartDock.ts";
import type { BaseModule } from "./modules/baseModule.ts";

/**
 * Aurora Shell Extension
 * 
 * Main extension that orchestrates all modules.
 * Each module is independent and can be enabled/disabled separately.
 */
export default class AuroraShellExtension extends Extension {
  private _modules: Map<string, BaseModule> = new Map();
  private _console: ConsoleLike | null = null;

  override enable(): void {
    this._console = this.getLogger();
    this._console?.log('Enabling extension');

    this._initializeModules();
    this._enableAllModules();
  }

  private _initializeModules(): void {
  this._modules.set('themeChanger', new ThemeChanger(this._console!));
  this._modules.set('smartDock', new SmartDock(this._console!));

    // Add more modules here as needed:
    // this._modules.set('moduleName', new ModuleName());
  }

  private _enableAllModules(): void {
    for (const [name, module] of this._modules) {
      try {
        module.enable();
      } catch (e) {
        this._console?.error(`Aurora Shell: Failed to enable module ${name}:`, e);
      }
    }
  }

  override disable(): void {
    this._console?.log('Aurora Shell: Disabling extension');

    for (const [name, module] of this._modules) {
      try {
        module.disable();
      } catch (e) {
        this._console?.error(`Aurora Shell: Failed to disable module ${name}:`, e);
      }
    }

    this._console = null;
    this._modules.clear();
  }
}
