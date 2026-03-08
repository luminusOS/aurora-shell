export type ModuleDefinition = {
  key: string;
  settingsKey: string;
  title: string;
  subtitle: string;
};

export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    key: 'no-overview',
    settingsKey: 'module-no-overview',
    title: 'No Overview',
    subtitle: 'Disables the overview at startup',
  },
  {
    key: 'pip-on-top',
    settingsKey: 'module-pip-on-top',
    title: 'Pip On Top',
    subtitle: 'Keeps Picture-in-Picture windows always on top',
  },
  {
    key: 'theme-changer',
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
    key: 'volume-mixer',
    settingsKey: 'module-volume-mixer',
    title: 'Volume Mixer',
    subtitle: 'Per-application volume control in Quick Settings',
  },
];
