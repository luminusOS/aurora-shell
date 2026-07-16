import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'vela-vpn-quick-settings',
  settingsKey: 'module-vela-vpn-quick-settings',
  section: 'behavior',
  title: _('Vela VPN Quick Settings'),
  subtitle: _('Routes VPN Quick Settings activation through Vela'),
  options: [
    {
      key: 'vela-vpn-quick-settings-shell-fallback',
      title: _('Use GNOME Shell Fallback'),
      subtitle: _('Use GNOME Shell only when the Vela D-Bus service or control API is unavailable'),
      type: 'switch',
    },
  ],
};
