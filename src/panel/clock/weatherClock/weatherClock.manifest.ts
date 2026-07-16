import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
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
};
