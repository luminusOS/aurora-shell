import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'dock',
  settingsKey: 'module-dock',
  section: 'dock-panel',
  title: _('Dock'),
  subtitle: _('Custom dock with auto-hide and intellihide features'),
  options: [
    {
      key: 'dock-always-show',
      title: _('Always Show Dock'),
      subtitle: _('Keep dock permanently visible and shrink windows so they never overlap it'),
      type: 'switch',
    },
    {
      key: 'dock-show-trash',
      title: _('Show Trash Icon'),
      subtitle: _('Show a trash can in the dock; click to open it, right-click to empty it'),
      type: 'switch',
    },
    {
      key: 'dock-show-external-storage',
      title: _('Show External Storage'),
      subtitle: _('Show removable drives in the dock when they are connected'),
      type: 'switch',
    },
  ],
};
