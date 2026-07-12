import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'volume-mixer',
  settingsKey: 'module-volume-mixer',
  section: 'dock-panel',
  title: _('Volume Mixer'),
  subtitle: _('Per-application volume control in Quick Settings'),
};
