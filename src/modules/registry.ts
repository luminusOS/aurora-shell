import { ThemeChanger } from "./themeChanger.ts";
import { Dock } from "./dock.ts";
import { NoOverview } from "./noOverview.ts";
import { PipOnTop } from "./pipOnTop.ts";
import type { Module } from "./module.ts";

/**
 * Module definition that includes both runtime and UI metadata
 */
export type ModuleDefinition = {
  /** Internal key used in the modules Map */
  key: string;
  /** GSettings schema key */
  settingsKey: string;
  /** Factory function to create module instance */
  create: () => Module;
  /** User-facing title for preferences UI */
  title: string;
  /** User-facing subtitle/description for preferences UI */
  subtitle: string;
};

/**
 * Single source of truth for all available modules.
 * To add a new module:
 * 1. Import its class at the top
 * 2. Add one entry to this array
 * 3. Add corresponding key to gschema.xml
 */
export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    key: 'themeChanger',
    settingsKey: 'module-theme-changer',
    create: () => new ThemeChanger(),
    title: 'Theme Changer',
    subtitle: 'Monitors and synchronizes GNOME color scheme',
  },
  {
    key: 'dock',
    settingsKey: 'module-dock',
    create: () => new Dock(),
    title: 'Dock',
    subtitle: 'Custom dock with auto-hide and intellihide features',
  },
  {
    key: 'noOverview',
    settingsKey: 'module-no-overview',
    create: () => new NoOverview(),
    title: 'No Overview',
    subtitle: 'Disables the overview at startup',
  },
  {
    key: 'pipOnTop',
    settingsKey: 'module-pip-on-top',
    create: () => new PipOnTop(),
    title: 'Pip On Top',
    subtitle: 'Keeps Picture-in-Picture windows always on top',
  },
];
