import { gettext as _ } from 'gettext';
import type { ModuleManifest } from '~/module.ts';

export const manifest: ModuleManifest = {
  key: 'app-search-tooltip',
  settingsKey: 'module-app-search-tooltip',
  section: 'appearance',
  title: _('App Search Tooltip'),
  subtitle: _('Shows app name on hover in the overview search results'),
};
