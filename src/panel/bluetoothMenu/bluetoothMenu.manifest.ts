import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'bluetooth-menu',
  settingsKey: 'module-bluetooth-menu',
  section: 'dock-panel',
  title: _('Bluetooth Menu'),
  subtitle: _('Shows battery level and animated icons in the Bluetooth Quick Settings panel'),
};
