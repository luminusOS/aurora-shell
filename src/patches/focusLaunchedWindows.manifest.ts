import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'focus-launched-windows',
  settingsKey: 'module-focus-launched-windows',
  section: 'behavior',
  title: _('Focus Launched Windows'),
  subtitle: _('Focuses newly launched windows instead of showing window-ready notifications'),
};
