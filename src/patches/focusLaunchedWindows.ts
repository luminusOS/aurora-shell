import { gettext as _ } from 'gettext';

import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';

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
