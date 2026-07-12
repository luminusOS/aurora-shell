import '@girs/gjs';

import type St from '@girs/st-18';

import {
  createDevToolActionButton,
  createDevToolActionRow,
  createDevToolModulePanel,
  createDevToolSummary,
} from '~/dev/devToolUi.ts';

export class GeneralDevTool {
  readonly key = 'general';
  readonly title = 'General';
  readonly iconName = 'emblem-system-symbolic';

  constructor(private readonly _openPreferences: () => void) {}

  buildPanel(): St.Widget {
    const panel = createDevToolModulePanel();
    panel.add_child(createDevToolSummary(this.iconName, 'Extension tools'));

    const row = createDevToolActionRow();
    row.add_child(
      createDevToolActionButton('emblem-system-symbolic', 'Open Settings', () =>
        this.openPreferences(),
      ),
    );
    panel.add_child(row);

    return panel;
  }

  destroy(): void {}

  openPreferences(): void {
    this._openPreferences();
  }
}
