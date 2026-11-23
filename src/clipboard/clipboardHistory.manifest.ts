import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'clipboard-history',
  settingsKey: 'module-clipboard-history',
  section: 'privacy-clipboard',
  title: _('Clipboard History'),
  subtitle: _('Browse copied text and images'),
  options: [
    {
      key: 'clipboard-history-indicator',
      title: _('Show Panel Indicator'),
      subtitle: _('Open clipboard history from the top bar'),
      type: 'switch',
    },
    {
      key: 'clipboard-history-persist',
      title: _('Remember History Between Sessions'),
      subtitle: _(
        'When off, use a separate session history. Previously saved items return when you turn this on.',
      ),
      type: 'switch',
    },
    {
      key: 'clipboard-history-link-previews',
      title: _('Link Previews'),
      subtitle: _(
        'Visit copied HTTPS links to load titles, descriptions, and images. Sites and image hosts will see your visits.',
      ),
      type: 'switch',
    },
    {
      key: 'clipboard-history-shortcut',
      title: _('Open Shortcut'),
      subtitle: _('Keyboard shortcut to open the clipboard history panel'),
      type: 'shortcut',
    },
    {
      key: 'clipboard-history-auto-paste',
      title: _('Paste Automatically'),
      subtitle: _(
        'Insert the selected text into the previously focused input. Warning: requires an active Wayland field that supports text-input-v3',
      ),
      type: 'switch',
    },
  ],
};
