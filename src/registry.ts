import { gettext as _ } from 'gettext';

export type ModuleDefinition = {
  key: string;
  settingsKey: string;
  title: string;
  subtitle: string;
};

export function getModuleRegistry(): ModuleDefinition[] {
  return [
    {
      key: 'no-overview',
      settingsKey: 'module-no-overview',
      title: _('No Overview'),
      subtitle: _('Disables the overview at startup'),
    },
    {
      key: 'pip-on-top',
      settingsKey: 'module-pip-on-top',
      title: _('Pip On Top'),
      subtitle: _('Keeps Picture-in-Picture windows always on top'),
    },
    {
      key: 'theme-changer',
      settingsKey: 'module-theme-changer',
      title: _('Theme Changer'),
      subtitle: _('Monitors and synchronizes GNOME color scheme'),
    },
    {
      key: 'dock',
      settingsKey: 'module-dock',
      title: _('Dock'),
      subtitle: _('Custom dock with auto-hide and intellihide features'),
    },
    {
      key: 'volume-mixer',
      settingsKey: 'module-volume-mixer',
      title: _('Volume Mixer'),
      subtitle: _('Per-application volume control in Quick Settings'),
    },
    {
      key: 'xwayland-indicator',
      settingsKey: 'module-xwayland-indicator',
      title: _('XWayland Indicator'),
      subtitle: _('Shows an X11 badge on XWayland apps in the Alt+Tab switcher'),
    },
  ];
}
