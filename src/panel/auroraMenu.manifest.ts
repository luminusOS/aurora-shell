import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'aurora-menu',
  settingsKey: 'module-aurora-menu',
  section: 'dock-panel',
  title: _('Aurora Menu'),
  subtitle: _('Aurora panel menu with recent items and useful shortcuts'),
  internalSettings: [
    'aurora-menu-custom-item-enabled',
    'aurora-menu-custom-item-label',
    'aurora-menu-custom-item-command',
  ],
  options: [
    {
      key: 'aurora-menu-icon',
      title: _('Menu Icon'),
      subtitle: _('Choose the icon shown in the top panel'),
      type: 'icon-select',
      choices: [
        { value: 'aurora', title: _('Aurora Shell'), iconName: 'aurora-shell-menu-symbolic' },
        { value: 'gnome', title: _('GNOME'), iconName: 'start-here-symbolic' },
        { value: 'luminus', title: _('Luminus OS'), iconName: 'luminus-os-symbolic' },
      ],
    },
    {
      key: 'aurora-menu-hide-activities',
      title: _('Hide Activities Button'),
      subtitle: _('Hide the Activities button while Aurora Menu is enabled'),
      type: 'switch',
    },
    {
      key: 'aurora-menu-show-about',
      title: _('Show About This PC'),
      subtitle: _('Show the About This PC item in Aurora Menu'),
      type: 'switch',
    },
    {
      key: 'aurora-menu-show-home',
      title: _('Show Home Folder'),
      subtitle: _('Show the Home Folder item in Aurora Menu'),
      type: 'switch',
    },
    {
      key: 'aurora-menu-show-downloads',
      title: _('Show Downloads'),
      subtitle: _('Show the Downloads item in Aurora Menu'),
      type: 'switch',
    },
    {
      key: 'aurora-menu-show-recent-items',
      title: _('Show Recent Items'),
      subtitle: _('Show the Recent Items submenu in Aurora Menu'),
      type: 'switch',
    },
    {
      key: 'aurora-menu-show-settings',
      title: _('Show System Settings'),
      subtitle: _('Show the System Settings item in Aurora Menu'),
      type: 'switch',
    },
    {
      key: 'aurora-menu-show-software',
      title: _('Show Software'),
      subtitle: _('Show the Software item in Aurora Menu'),
      type: 'switch',
    },
    {
      key: 'aurora-menu-show-extensions',
      title: _('Show Extensions'),
      subtitle: _('Show the Extensions item in Aurora Menu'),
      type: 'switch',
    },
    {
      key: 'aurora-menu-app-store-command',
      title: _('Software Command'),
      subtitle: _('Command used by the Software menu item'),
      type: 'entry',
    },
    {
      key: 'aurora-menu-custom-items',
      title: _('Custom Menu Commands'),
      subtitle: _('One command per line, using “Label | command”'),
      type: 'command-list',
    },
  ],
};
