import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'icon-weave',
  settingsKey: 'module-icon-weave',
  section: 'appearance',
  title: _('Icon Weave'),
  subtitle: _('Automatically fixes missing app icons using an in-memory approach'),
};
