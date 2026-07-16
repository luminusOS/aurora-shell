import { gettext as _ } from '~/shared/i18n.ts';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'capture-tools',
  settingsKey: 'module-capture-tools',
  section: 'behavior',
  title: _('Capture Tools'),
  subtitle: _('Show annotation tools when the screenshot interface opens'),
  options: [
    {
      key: 'capture-tools-ocr-enabled',
      title: _('Optical character recognition'),
      subtitle: _('Show a local Tesseract OCR action beside the pointer control'),
      type: 'switch',
    },
    {
      key: 'capture-tools-ocr-languages',
      title: _('OCR languages'),
      subtitle: _('Tesseract language codes separated by +; leave empty for system language'),
      type: 'entry',
    },
    {
      key: 'capture-tools-web-search-engine',
      title: _('Web search engine'),
      subtitle: _('Choose the service used to search recognized text'),
      type: 'select',
      choices: [
        { value: 'google', title: _('Google') },
        { value: 'duckduckgo', title: _('DuckDuckGo') },
        { value: 'bing', title: _('Bing') },
      ],
    },
  ],
  internalSettings: ['capture-tools-color', 'capture-tools-stroke-width'],
  runtime: { roles: ['desktop'], scope: 'session' },
};
