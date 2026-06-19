import { gettext as _ } from 'gettext';

import type { ModuleMetadata } from '~/module.ts';

export type { ModuleOption, ModuleMetadata } from '~/module.ts';

/**
 * Preferences sections, in display order.
 *
 * Each module declares a `section` id matching one of these; `prefs.ts` renders
 * one `Adw.PreferencesGroup` per section and places modules under it. To add a
 * new section, append an entry here and reference its `id` from a module's
 * `definition` (and this file's mirror). `tests/unit/registry.test.ts` enforces
 * that every module's `section` is a known id.
 */
export type ModuleSection = { id: string; title: string };

export function getSections(): ModuleSection[] {
  return [
    { id: 'dock-panel', title: _('Dock &amp; Panel') },
    { id: 'appearance', title: _('Appearance') },
    { id: 'behavior', title: _('Behavior') },
    { id: 'privacy-clipboard', title: _('Privacy &amp; Clipboard') },
  ];
}

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
      section: 'behavior',
      title: _('No Overview'),
      subtitle: _('Disables the overview at startup'),
    },
    {
      key: 'pip-on-top',
      settingsKey: 'module-pip-on-top',
      section: 'behavior',
      title: _('Pip On Top'),
      subtitle: _('Keeps Picture-in-Picture windows always on top'),
    },
    {
      key: 'theme-changer',
      settingsKey: 'module-theme-changer',
      section: 'appearance',
      title: _('Theme Changer'),
      subtitle: _('Monitors and synchronizes GNOME color scheme'),
    },
    {
      key: 'dock',
      settingsKey: 'module-dock',
      section: 'dock-panel',
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
      section: 'dock-panel',
      title: _('Volume Mixer'),
      subtitle: _('Per-application volume control in Quick Settings'),
    },
    {
      key: 'xwayland-indicator',
      settingsKey: 'module-xwayland-indicator',
      section: 'behavior',
      title: _('XWayland Indicator'),
      subtitle: _('Shows an X11 badge on XWayland apps in the Alt+Tab switcher'),
    },
    {
      key: 'privacy',
      settingsKey: 'module-privacy',
      section: 'privacy-clipboard',
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
      section: 'appearance',
      title: _('Icon Weave'),
      subtitle: _('Automatically fixes missing app icons using an in-memory approach'),
    },
    {
      key: 'app-search-tooltip',
      settingsKey: 'module-app-search-tooltip',
      section: 'appearance',
      title: _('App Search Tooltip'),
      subtitle: _('Shows app name on hover in the overview search results'),
    },
    {
      key: 'auto-theme-switcher',
      settingsKey: 'module-auto-theme-switcher',
      section: 'appearance',
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
      key: 'bluetooth-menu',
      settingsKey: 'module-bluetooth-menu',
      section: 'dock-panel',
      title: _('Bluetooth Menu'),
      subtitle: _('Shows battery level and animated icons in the Bluetooth Quick Settings panel'),
    },
    {
      key: 'weather-clock',
      settingsKey: 'module-weather-clock',
      section: 'dock-panel',
      title: _('Weather Clock'),
      subtitle: _('Shows GNOME Weather next to the clock'),
      options: [
        {
          key: 'weather-clock-after-clock',
          title: _('Show Weather After Clock'),
          subtitle: _('Place the weather indicator after the clock instead of before it'),
          type: 'switch',
        },
      ],
    },
    {
      key: 'meeting-clock',
      settingsKey: 'module-meeting-clock',
      section: 'dock-panel',
      title: _('Meeting Clock'),
      subtitle: _('Shows upcoming calendar events next to the clock'),
      options: [
        {
          key: 'meeting-clock-alerts-enabled',
          title: _('Meeting Alerts'),
          subtitle: _('Show a notification when a meeting is about to start'),
          type: 'switch',
        },
        {
          key: 'meeting-clock-alert-minutes-before',
          title: _('Alert Lead Time (minutes)'),
          subtitle: _('Minutes before a meeting starts to show the alert'),
          type: 'spin',
          min: 0,
          max: 60,
        },
        {
          key: 'meeting-clock-snooze-minutes',
          title: _('Snooze Duration (minutes)'),
          subtitle: _('Minutes to wait before showing a snoozed alert again'),
          type: 'spin',
          min: 1,
          max: 60,
        },
        {
          key: 'meeting-clock-alert-events-without-link',
          title: _('Alert Events Without Links'),
          subtitle: _('Show meeting alerts for calendar events that do not include a join link'),
          type: 'switch',
        },
        {
          key: 'meeting-clock-panel-reveal-interval-minutes',
          title: _('Panel Reveal Interval (minutes)'),
          subtitle: _('Minutes between automatic Meeting Clock slide reveals in the panel'),
          type: 'spin',
          min: 1,
          max: 60,
        },
        {
          key: 'meeting-clock-panel-lookahead-minutes',
          title: _('Panel Lookahead (minutes)'),
          subtitle: _('Maximum minutes before an event starts for it to appear in the panel clock'),
          type: 'spin',
          min: 0,
          max: 1440,
        },
        {
          key: 'meeting-clock-exclude-all-day-events',
          title: _('Hide All-Day Events'),
          subtitle: _('Exclude all-day events from the clock and alerts'),
          type: 'switch',
        },
      ],
    },
    {
      key: 'tray-icons',
      settingsKey: 'module-tray-icons',
      section: 'dock-panel',
      title: _('Tray Icons'),
      subtitle: _('System tray with SNI and background app icons'),
      options: [
        {
          key: 'tray-icons-limit',
          title: _('Visible Icon Limit'),
          subtitle: _('Maximum number of icons shown before the expand button appears'),
          type: 'spin',
          min: 1,
          max: 20,
        },
        {
          key: 'tray-icons-icon-size',
          title: _('Icon Size'),
          subtitle: _('Tray icon size in pixels (14–24)'),
          type: 'spin',
          min: 14,
          max: 24,
        },
        {
          key: 'tray-icons-attention-timeout',
          title: _('Attention Auto-Collapse (seconds)'),
          subtitle: _('Seconds before the tray collapses after a notification icon appears'),
          type: 'spin',
          min: 1,
          max: 30,
        },
        {
          key: 'tray-icons-dedup-bg-apps',
          title: _('Hide Background App When Tray Icon Present'),
          subtitle: _('Remove the background app icon when the same app has an SNI tray icon'),
          type: 'switch',
        },
        {
          key: 'tray-icons-hide-bg-quick-settings',
          title: _('Hide Background Apps from Quick Settings'),
          subtitle: _('Hide the Background Apps section from the Quick Settings dropdown'),
          type: 'switch',
        },
        {
          key: 'tray-icons-recolor-symbolic-pixmaps',
          title: _('Recolor Symbolic Tray Icons'),
          subtitle: _('Automatically recolor monochrome SNI icons to match the panel theme'),
          type: 'switch',
        },
      ],
    },
    {
      key: 'clipboard-history',
      settingsKey: 'module-clipboard-history',
      section: 'privacy-clipboard',
      title: _('Clipboard History'),
      subtitle: _('Searchable clipboard history with pinning and keyboard navigation'),
      options: [
        {
          key: 'clipboard-history-shortcut',
          title: _('Open Shortcut'),
          subtitle: _('Keyboard shortcut to open the clipboard history panel'),
          type: 'shortcut',
        },
        {
          key: 'clipboard-history-poll-interval',
          title: _('Poll Interval (ms)'),
          subtitle: _('How often to check the clipboard for changes'),
          type: 'spin',
          min: 250,
          max: 5000,
        },
      ],
    },
  ];
}
