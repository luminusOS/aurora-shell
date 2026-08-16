import { gettext as _ } from '~/shared/i18n.ts';
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
      key: 'dock-intellihide',
      title: _('Intelligent Auto-Hide Dock'),
      subtitle: _('Keep the dock visible until a window overlaps it'),
      type: 'switch',
    },
    {
      key: 'dock-show-on-all-monitors',
      title: _('Show Dock on All Monitors'),
      subtitle: _(
        'Create a separate dock for each monitor; otherwise, the primary dock shows all workspace apps',
      ),
      type: 'switch',
    },
    {
      key: 'dock-icon-size',
      title: _('Maximum Icon Size'),
      subtitle: _('Maximum dock icon size in pixels (16–64); shrinks automatically when needed'),
      type: 'spin',
      min: 16,
      max: 64,
      resettable: true,
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
    {
      key: 'dock-motion-enabled',
      title: _('Icon Hover &amp; Press Effects'),
      subtitle: _('Animate dock icons on hover and click'),
      type: 'switch',
    },
    {
      key: 'dock-motion-profile',
      title: _('Effect Intensity'),
      subtitle: _('How strong the hover and press effects are'),
      type: 'select',
      choices: [
        { value: 'subtle', title: _('Subtle') },
        { value: 'balanced', title: _('Balanced') },
        { value: 'expressive', title: _('Expressive') },
      ],
    },
  ],
};
