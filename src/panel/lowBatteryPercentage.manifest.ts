import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'low-battery-percentage',
  settingsKey: 'module-low-battery-percentage',
  section: 'dock-panel',
  title: _('Low Battery Percentage'),
  subtitle: _('Shows battery percentage in the panel while below 20%'),
};
