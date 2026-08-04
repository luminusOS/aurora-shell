import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'power-menu-avatar',
  settingsKey: 'module-power-menu-avatar',
  section: 'dock-panel',
  title: _('Power Menu Avatar'),
  subtitle: _("Shows the current user's avatar and name in the power menu"),
};
