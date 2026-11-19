import GLib from 'gi://GLib';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { action, type RuntimeAction } from './protocol.ts';
import { gettext as _ } from '~/shared/i18n.ts';

export class GeneralDevTool {
  readonly key = 'general';
  readonly title = 'General';

  constructor(
    private readonly _versionName: string,
    private readonly _enabledModules: () => number,
  ) {}

  describe() {
    const actions: RuntimeAction[] = [];
    const details: string[] = [];
    details.push(`Aurora Shell ${this._versionName}`);

    details.push(_('GNOME Shell') + ': ' + Config.PACKAGE_VERSION);
    details.push(_('Session') + ': ' + (GLib.getenv('XDG_SESSION_TYPE') || _('Unknown')));
    details.push(_('Enabled modules') + ': ' + String(this._enabledModules()));

    actions.push(
      action('looking-glass', _('Looking Glass'), () => Main.createLookingGlass().open(), false),
    );

    return { details, actions };
  }
}
