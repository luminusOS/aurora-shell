import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'lock-key-indicators',
  settingsKey: 'module-lock-key-indicators',
  section: 'dock-panel',
  title: _('Lock Key Indicators'),
  subtitle: _('Shows Caps Lock and Num Lock indicators in the top panel'),
};
