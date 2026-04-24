import { gettext as _ } from 'gettext';

import type { ModuleMetadata } from '~/moduleDefinition.ts';

export type { ModuleOption, ModuleMetadata } from '~/moduleDefinition.ts';

/**
 * Metadata mirror for the preferences UI.
 *
 * Prefs runs in `gnome-extensions-app` (GTK/Adw) — NOT inside gnome-shell — so
 * it cannot statically import anything that resolves to `resource:///org/gnome/shell/*`.
 * Because module source files import shell internals (Main, Search, AltTab, etc.),
 * they cannot be imported here. This file is a hand-maintained mirror of the
 * metadata portion of each module's `definition` export.
 *
 * The registry ↔ prefsMetadata parity is enforced by `tests/unit/registry.test.ts`.
 * If you add a module, update both this file and the module's own `definition`.
 */
export function getModuleMetadata(): ModuleMetadata[] {
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
      key: 'privacy',
      settingsKey: 'module-privacy',
      title: _('Privacy'),
      subtitle: _('Screen sharing privacy features'),
      options: [
        {
          key: 'privacy-dnd-on-share',
          title: _('DND on Screen Share'),
          subtitle: _('Automatically enables Do Not Disturb mode when screen sharing'),
          type: 'switch',
        },
        {
          key: 'privacy-panel',
          title: _('Privacy Panel'),
          subtitle: _(
            'Hides panel content during screen sharing; shows only the sharing indicator',
          ),
          type: 'switch',
        },
      ],
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
    {
      key: 'auto-theme-switcher',
      settingsKey: 'module-auto-theme-switcher',
      title: _('Auto Theme Switcher'),
      subtitle: _('Automatically switches between light and dark theme based on time'),
      options: [
        {
          hourKey: 'auto-theme-switcher-light-hours',
          minuteKey: 'auto-theme-switcher-light-minutes',
          title: _('Light Time'),
          subtitle: _('Time to switch to light theme (HH:MM)'),
          type: 'time',
        },
        {
          hourKey: 'auto-theme-switcher-dark-hours',
          minuteKey: 'auto-theme-switcher-dark-minutes',
          title: _('Dark Time'),
          subtitle: _('Time to switch to dark theme (HH:MM)'),
          type: 'time',
        },
      ],
    },
    {
      key: 'workspace-thumbnails',
      settingsKey: 'module-workspace-thumbnails',
      title: _('Workspace Thumbnails DnD'),
      subtitle: _('Drag windows between workspaces from the overview side panel'),
    },
    {
      key: 'bluetooth-menu',
      settingsKey: 'module-bluetooth-menu',
      title: _('Bluetooth Menu'),
      subtitle: _('Shows battery level and animated icons in the Bluetooth Quick Settings panel'),
    },
  ];
}
