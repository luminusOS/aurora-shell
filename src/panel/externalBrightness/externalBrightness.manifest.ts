import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'external-brightness',
  settingsKey: 'module-external-brightness',
  section: 'dock-panel',
  title: _('External Display Brightness'),
  subtitle: _(
    'Combine built-in and external display brightness in one Quick Settings control. Requires DDC/CI and ddcutil-service',
  ),
  runtime: { roles: ['desktop'], scope: 'session' },
  internalSettings: ['external-brightness-calibrations'],
  options: [
    {
      type: 'brightness-calibration',
      title: _('Monitor calibration'),
      subtitle: _('Configure raw DDC limits or pause individual external displays'),
    },
  ],
};
