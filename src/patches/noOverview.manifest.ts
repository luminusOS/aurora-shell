import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'no-overview',
  settingsKey: 'module-no-overview',
  section: 'behavior',
  title: _('Skip Overview on Login'),
  subtitle: _('Goes directly to the desktop when GNOME Shell starts'),
};
