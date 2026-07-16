import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'pip-on-top',
  settingsKey: 'module-pip-on-top',
  section: 'behavior',
  title: _('Pip On Top'),
  subtitle: _('Keeps Picture-in-Picture windows always on top'),
};
