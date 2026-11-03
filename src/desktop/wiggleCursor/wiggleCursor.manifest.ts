import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'wiggle-cursor',
  settingsKey: 'module-wiggle-cursor',
  section: 'behavior',
  title: _('Wiggle Cursor'),
  subtitle: _('Shake the mouse to enlarge the pointer. Needs an SVG cursor theme'),
  runtime: { roles: ['desktop'], scope: 'session' },
};
