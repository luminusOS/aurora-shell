
import '@girs/gjs';

import Gio from "@girs/gio-2.0";
import { Extension, gettext as _ } from "@girs/gnome-shell/extensions/extension";


import { ThemeChanger } from "./modules/themeChanger.ts";
import { Dock } from "./modules/dock.ts";
import { NoOverview } from "./modules/noOverview.ts";
import { PipOnTop } from "./modules/pipOnTop.ts";
import type { Module } from "./modules/module.ts";

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
    if (this._settings?.get_boolean('module-theme-changer')) {
      this._modules.set('themeChanger', new ThemeChanger());
    }

    if (this._settings?.get_boolean('module-dock')) {
      this._modules.set('dock', new Dock());
    }

    if (this._settings?.get_boolean('module-no-overview')) {
      this._modules.set('noOverview', new NoOverview());
    }

    if (this._settings?.get_boolean('module-pip-on-top')) {
      this._modules.set('pipOnTop', new PipOnTop());
    }

    // Add more modules here as needed:
    // if (this._settings?.get_boolean('module-example')) {
    //   this._modules.set('example', new ExampleModule());
    // }
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

    // Watch for theme-changer module setting changes
    const themeChangerId = this._settings.connect('changed::module-theme-changer', () => {
      this._toggleModule('themeChanger', ThemeChanger, this._settings!.get_boolean('module-theme-changer'));
    });
    this._settingsHandlers.push(themeChangerId);

    // Watch for dock module setting changes
    const dockId = this._settings.connect('changed::module-dock', () => {
      this._toggleModule('dock', Dock, this._settings!.get_boolean('module-dock'));
    });
    this._settingsHandlers.push(dockId);

    // Watch for no-overview module setting changes
    const noOverviewId = this._settings.connect('changed::module-no-overview', () => {
      this._toggleModule('noOverview', NoOverview, this._settings!.get_boolean('module-no-overview'));
    });
    this._settingsHandlers.push(noOverviewId);

    // Watch for pip-on-top module setting changes
    const pipOnTopId = this._settings.connect('changed::module-pip-on-top', () => {
      this._toggleModule('pipOnTop', PipOnTop, this._settings!.get_boolean('module-pip-on-top'));
    });
    this._settingsHandlers.push(pipOnTopId);

    // Add more module watchers here as needed
  }

  private _toggleModule(name: string, ModuleClass: new () => Module, enabled: boolean): void {
    const existingModule = this._modules.get(name);

    if (enabled && !existingModule) {
      // Enable module
      console.log(`Aurora Shell: Enabling module ${name}`);
      try {
        const module = new ModuleClass();
        module.enable();
        this._modules.set(name, module);
      } catch (e) {
        console.error(`Aurora Shell: Failed to enable module ${name}:`, e);
      }
    } else if (!enabled && existingModule) {
      // Disable module
      console.log(`Aurora Shell: Disabling module ${name}`);
      try {
        existingModule.disable();
        this._modules.delete(name);
      } catch (e) {
        console.error(`Aurora Shell: Failed to disable module ${name}:`, e);
      }
    }
  }

  override disable(): void {
    console.log('Aurora Shell: Disabling extension');

    // Disconnect all settings handlers
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
