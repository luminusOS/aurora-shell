import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'foreground-bridge',
  settingsKey: 'module-foreground-bridge',
  section: 'behavior',
  title: _('Foreground Booster Bridge'),
  subtitle: _('Reports the focused application to gnome-foreground-booster'),
};
