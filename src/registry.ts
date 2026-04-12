import { gettext as _ } from 'gettext';

export type ModuleOption = {
  key: string;
  title: string;
  subtitle: string;
  type: 'switch';
};

export type ModuleDefinition = {
  key: string;
  settingsKey: string;
  title: string;
  subtitle: string;
  options?: ModuleOption[];
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
      options: [
        {
          key: 'dock-always-show',
          title: _('Always Show Dock'),
          subtitle: _('Keep dock permanently visible and shrink windows so they never overlap it'),
          type: 'switch',
        },
      ],
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
    {
      key: 'dnd-on-share',
      settingsKey: 'module-dnd-on-share',
      title: _('DND on Screen Share'),
      subtitle: _('Automatically enables Do Not Disturb mode when screen sharing'),
    },
    {
      key: 'icon-weave',
      settingsKey: 'module-icon-weave',
      title: _('Icon Weave'),
      subtitle: _('Automatically fixes missing app icons using an in-memory approach'),
    },
    {
      key: 'app-search-tooltip',
      settingsKey: 'module-app-search-tooltip',
      title: _('App Search Tooltip'),
      subtitle: _('Shows app name on hover in the overview search results'),
    },
  ];
}
