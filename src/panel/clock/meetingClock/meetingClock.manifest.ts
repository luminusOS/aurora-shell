import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
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
};
