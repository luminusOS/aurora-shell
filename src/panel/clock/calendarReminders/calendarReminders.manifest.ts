import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'calendar-reminders',
  settingsKey: 'module-calendar-reminders',
  section: 'dock-panel',
  title: _('Calendar Reminders'),
  subtitle: _('Shows upcoming events next to the clock and notifies calendar reminders'),
  options: [
    {
      key: 'calendar-reminders-alerts-enabled',
      title: _('Notifications'),
      subtitle: _('Show calendar reminders as notifications'),
      type: 'switch',
    },
    {
      key: 'calendar-reminders-force-reminders',
      title: _('Force Reminder at Event Start'),
      subtitle: _('Always notify when a timed event starts, even after an earlier reminder'),
      type: 'switch',
    },
    {
      key: 'calendar-reminders-snooze-minutes',
      title: _('Snooze Duration (minutes)'),
      subtitle: _('Minutes to wait before showing a snoozed alert again'),
      type: 'spin',
      min: 1,
      max: 60,
    },
    {
      key: 'calendar-reminders-panel-reveal-interval-minutes',
      title: _('Panel Reveal Interval (minutes)'),
      subtitle: _('Minutes between automatic Calendar Reminders slide reveals in the panel'),
      type: 'spin',
      min: 1,
      max: 60,
    },
    {
      key: 'calendar-reminders-panel-lookahead-minutes',
      title: _('Panel Lookahead (minutes)'),
      subtitle: _('Maximum minutes before an event starts for it to appear in the panel clock'),
      type: 'spin',
      min: 0,
      max: 1440,
    },
    {
      key: 'calendar-reminders-exclude-all-day-events',
      title: _('Hide All-Day Events'),
      subtitle: _('Exclude all-day events from the panel clock'),
      type: 'switch',
    },
  ],
};
