import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
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
};
