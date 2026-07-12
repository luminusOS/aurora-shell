import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'tray-icons',
  settingsKey: 'module-tray-icons',
  section: 'dock-panel',
  title: _('Tray Icons'),
  subtitle: _('System tray with SNI and background app icons'),
  runtime: { roles: ['desktop'], scope: 'session' },
  options: [
    {
      key: 'tray-icons-limit',
      title: _('Visible Icon Limit'),
      subtitle: _('Maximum number of icons shown before the expand button appears'),
      type: 'spin',
      min: 1,
      max: 20,
    },
    {
      key: 'tray-icons-icon-size',
      title: _('Icon Size'),
      subtitle: _('Tray icon size in pixels (14–24)'),
      type: 'spin',
      min: 14,
      max: 24,
    },
    {
      key: 'tray-icons-attention-timeout',
      title: _('Attention Auto-Collapse (seconds)'),
      subtitle: _('Seconds before the tray collapses after a notification icon appears'),
      type: 'spin',
      min: 1,
      max: 30,
    },
    {
      key: 'tray-icons-dedup-bg-apps',
      title: _('Hide Background App When Tray Icon Present'),
      subtitle: _('Remove the background app icon when the same app has an SNI tray icon'),
      type: 'switch',
    },
    {
      key: 'tray-icons-hide-bg-quick-settings',
      title: _('Hide Background Apps from Quick Settings'),
      subtitle: _('Hide the Background Apps section from the Quick Settings dropdown'),
      type: 'switch',
    },
    {
      key: 'tray-icons-recolor-symbolic-pixmaps',
      title: _('Recolor Symbolic Tray Icons'),
      subtitle: _('Automatically recolor monochrome SNI icons to match the panel theme'),
      type: 'switch',
    },
  ],
};
