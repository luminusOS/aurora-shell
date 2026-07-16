import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'privacy',
  settingsKey: 'module-privacy',
  section: 'privacy-clipboard',
  title: _('Privacy'),
  subtitle: _('Screen sharing privacy features'),
  options: [
    {
      key: 'privacy-dnd-on-share',
      title: _('DND on Screen Share'),
      subtitle: _('Automatically enables Do Not Disturb mode when screen sharing'),
      type: 'switch',
    },
    {
      key: 'privacy-panel',
      title: _('Privacy Panel'),
      subtitle: _('Hides panel content during screen sharing; shows only the sharing indicator'),
      type: 'switch',
    },
  ],
};
