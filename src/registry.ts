/**
 * Module definition that includes both runtime and UI metadata
 */
export type ModuleDefinition = {
  /** Internal key used in the modules Map */
  key: string;
  /** GSettings schema key */
  settingsKey: string;
  /** User-facing title for preferences UI */
  title: string;
  /** User-facing subtitle/description for preferences UI */
  subtitle: string;
};

/**
 * Single source of truth for all available modules.
 * To add a new module:
 * 1. Add one entry to this array
 * 2. Add a factory entry in extension.ts MODULE_FACTORIES
 * 3. Add corresponding key to gschema.xml
 */
export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    key: 'themeChanger',
    settingsKey: 'module-theme-changer',
    title: 'Theme Changer',
    subtitle: 'Monitors and synchronizes GNOME color scheme',
  },
  {
    key: 'dock',
    settingsKey: 'module-dock',
    title: 'Dock',
    subtitle: 'Custom dock with auto-hide and intellihide features',
  },
  {
    key: 'noOverview',
    settingsKey: 'module-no-overview',
    title: 'No Overview',
    subtitle: 'Disables the overview at startup',
  },
  {
    key: 'pipOnTop',
    settingsKey: 'module-pip-on-top',
    title: 'Pip On Top',
    subtitle: 'Keeps Picture-in-Picture windows always on top',
  },
];
