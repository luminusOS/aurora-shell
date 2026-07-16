import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'xwayland-indicator',
  settingsKey: 'module-xwayland-indicator',
  section: 'behavior',
  title: _('XWayland Indicator'),
  subtitle: _('Shows an X11 badge on XWayland apps in the Alt+Tab switcher'),
};
