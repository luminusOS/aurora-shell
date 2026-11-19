import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'shell-background-effects',
  settingsKey: 'module-shell-background-effects',
  section: 'dock-panel',
  title: _('Transparency'),
  subtitle: _('Let the desktop show through the panel and dock'),
  options: [
    {
      key: 'shell-background-effects-panel',
      title: _('Translucent Top Bar'),
      subtitle: _('Show the desktop behind the top bar'),
      type: 'switch',
    },
    {
      key: 'shell-background-effects-dock',
      title: _('Translucent Dock'),
      subtitle: _('Use a translucent background for the Aurora Dock'),
      type: 'switch',
    },
    {
      key: 'shell-background-effects-blur',
      title: _('Blur Behind the Top Bar'),
      subtitle: _('Soften the background when the top bar is translucent'),
      type: 'switch',
    },
  ],
};
