import type St from 'gi://St';
import GLib from 'gi://GLib';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
  createDevToolActionButton,
  createDevToolActionRow,
  createDevToolGroup,
  createDevToolModulePanel,
  createDevToolRow,
  createDevToolSummary,
} from '~/dev/devToolUi.ts';
import { gettext as _ } from '~/shared/i18n.ts';

export class GeneralDevTool {
  readonly key = 'general';
  readonly title = 'General';
  readonly iconName = 'emblem-system-symbolic';

  constructor(
    private readonly _openPreferences: () => void,
    private readonly _closeDevTool: () => void,
    private readonly _versionName: string,
    private readonly _enabledModules: () => number,
  ) {}

  buildPanel(): St.Widget {
    const panel = createDevToolModulePanel();
    panel.add_child(createDevToolSummary(this.iconName, `Aurora Shell ${this._versionName}`));

    const environment = createDevToolGroup(_('Environment'));
    environment.list.add_child(createDevToolRow(_('GNOME Shell'), Config.PACKAGE_VERSION));
    environment.list.add_child(
      createDevToolRow(_('Session'), GLib.getenv('XDG_SESSION_TYPE') || _('Unknown')),
    );
    environment.list.add_child(
      createDevToolRow(_('Enabled modules'), String(this._enabledModules())),
    );
    panel.add_child(environment.container);

    const row = createDevToolActionRow();
    row.add_child(
      createDevToolActionButton(
        'emblem-system-symbolic',
        _('Open Settings'),
        this._openPreferences,
        false,
        false,
        'suggested',
      ),
    );
    row.add_child(
      createDevToolActionButton('utilities-terminal-symbolic', _('Looking Glass'), () => {
        this._closeDevTool();
        Main.createLookingGlass().open();
      }),
    );
    panel.add_child(row);

    return panel;
  }
}
