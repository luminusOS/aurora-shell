import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'volume-mixer',
  settingsKey: 'module-volume-mixer',
  section: 'dock-panel',
  title: _('Volume Mixer'),
  subtitle: _('Per-application volume control in Quick Settings'),
  options: [
    {
      key: 'volume-mixer-always-show',
      title: _('Always Show'),
      subtitle: _('Show the Volume Mixer button even when no applications are playing audio'),
      type: 'switch',
    },
  ],
};
