// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
import type { Module } from '~/module.ts';

export type ModuleDefinition = {
  key: string;
  settingsKey: string;
  title: string;
  subtitle: string;
};

import { NoOverview } from '~/modules/noOverview.ts';
import { PipOnTop } from '~/modules/pipOnTop.ts';
import { ThemeChanger } from '~/modules/themeChanger.ts';
import { Dock } from '~/modules/dock/dock.ts';
import { VolumeMixer } from '~/modules/volumeMixer/volumeMixer.ts';

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

export const MODULE_FACTORIES: Record<string, () => Module> = {
  'no-overview': () => new NoOverview(),
  'pip-on-top': () => new PipOnTop(),
  'theme-changer': () => new ThemeChanger(),
  'dock': () => new Dock(),
  'volume-mixer': () => new VolumeMixer(),
};
