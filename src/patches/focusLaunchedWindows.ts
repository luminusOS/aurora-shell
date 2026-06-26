import { gettext as _ } from 'gettext';

import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';

export class FocusLaunchedWindows extends Module {
  private _demandsAttentionId = 0;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._demandsAttentionId = global.display.connect(
      'window-demands-attention',
      (_display, window) => {
        Main.activateWindow(window);
      },
    );
  }

  override disable(): void {
    if (this._demandsAttentionId) {
      global.display.disconnect(this._demandsAttentionId);
      this._demandsAttentionId = 0;
    }
  }
}

export const definition: ModuleDefinition = {
  key: 'focus-launched-windows',
  settingsKey: 'module-focus-launched-windows',
  section: 'behavior',
  title: _('Focus Launched Windows'),
  subtitle: _('Focuses newly launched windows instead of showing window-ready notifications'),
  factory: (ctx) => new FocusLaunchedWindows(ctx),
};
