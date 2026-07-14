import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'clipboard-history',
  settingsKey: 'module-clipboard-history',
  section: 'privacy-clipboard',
  title: _('Clipboard History'),
  subtitle: _('Searchable clipboard history with pinning and keyboard navigation'),
  options: [
    {
      key: 'clipboard-history-shortcut',
      title: _('Open Shortcut'),
      subtitle: _('Keyboard shortcut to open the clipboard history panel'),
      type: 'shortcut',
    },
    {
      key: 'clipboard-history-auto-paste',
      title: _('Paste Automatically'),
      subtitle: _('Insert the selected text into the previously focused input'),
      type: 'switch',
    },
    {
      key: 'clipboard-history-poll-interval',
      title: _('Poll Interval (ms)'),
      subtitle: _('How often to check the clipboard for changes'),
      type: 'spin',
      min: 250,
      max: 5000,
    },
  ],
};
