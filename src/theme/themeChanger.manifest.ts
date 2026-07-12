import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'theme-changer',
  settingsKey: 'module-theme-changer',
  section: 'appearance',
  title: _('Theme Changer'),
  subtitle: _('Monitors and synchronizes GNOME color scheme'),
};
