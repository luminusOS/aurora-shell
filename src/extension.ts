
import '@girs/gjs';

import type Gio from "@girs/gio-2.0";
import { Extension } from "@girs/gnome-shell/extensions/extension";

import type { Module } from "./module.ts";
import { getModuleRegistry, type ModuleDefinition } from "./registry.ts";
import type { ExtensionContext } from "~/core/context.ts";
import { DefaultExtensionContext } from "~/core/context.ts";
import { ConsoleLogger } from "~/core/logger.ts";
import { GSettingsManager } from "~/core/settings.ts";
import { GnomeShellAdapter } from "~/core/adapters/shell.ts";

import { NoOverview } from "~/modules/noOverview.ts";
import { PipOnTop } from "~/modules/pipOnTop.ts";
import { ThemeChanger } from "~/modules/themeChanger.ts";
import { Dock } from "~/modules/dock/dock.ts";
import { VolumeMixer } from "~/modules/volumeMixer/volumeMixer.ts";
import { XwaylandIndicator } from "~/modules/xwaylandIndicator.ts";
import { DndOnShare } from "~/modules/dndOnShare.ts";

const MODULE_FACTORIES: Record<string, (context: ExtensionContext) => Module> = {
  'no-overview': (ctx) => new NoOverview(ctx),
  'pip-on-top': (ctx) => new PipOnTop(ctx),
  'theme-changer': (ctx) => new ThemeChanger(ctx),
  'dock': (ctx) => new Dock(ctx),
  'volume-mixer': (ctx) => new VolumeMixer(ctx),
  'xwayland-indicator': (ctx) => new XwaylandIndicator(ctx),
  'dnd-on-share': (ctx) => new DndOnShare(ctx),
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
  private _context: ExtensionContext | null = null;

  override enable(): void {
    console.log('Enabling extension');

    this._settings = this.getSettings();
    this._context = new DefaultExtensionContext(
      this.uuid,
      this.path,
      new ConsoleLogger('Aurora Shell'),
      new GSettingsManager(this._settings),
      new GnomeShellAdapter()
    );

    this._initializeModules();
    this._enableAllModules();
    this._connectSettings();
  }

  private _initializeModules(): void {
    for (const def of getModuleRegistry()) {
      if (this._settings?.get_boolean(def.settingsKey)) {
        // @ts-ignore
        this._modules.set(def.key, MODULE_FACTORIES[def.key](this._context!));
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
      console.log(`Aurora Shell: Enabling module ${def.key}`);
      try {
        // @ts-ignore
        const module = MODULE_FACTORIES[def.key](this._context!);
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

    // @ts-ignore
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
    this._context = null;
  }
}
