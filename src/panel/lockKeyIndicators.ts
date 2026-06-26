import '@girs/gjs';
import { gettext as _ } from 'gettext';

import Clutter from '@girs/clutter-18';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';
import type { Button as PanelMenuButton } from '@girs/gnome-shell/ui/panelMenu';
import * as PanelMenu from '@girs/gnome-shell/ui/panelMenu';

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';

const LOG_PREFIX = 'LockKeyIndicators';
const STATUS_AREA_ID = 'aurora-lock-key-indicators';

type Keymap = {
  connect(signal: 'state-changed', callback: () => void): number;
  disconnect(id: number): void;
  get_caps_lock_state(): boolean;
  get_num_lock_state(): boolean;
};

export class LockKeyIndicators extends Module {
  private _button: PanelMenu.Button | null = null;
  private _capsLabel: St.Label | null = null;
  private _numLabel: St.Label | null = null;
  private _keymap: Keymap | null = null;
  private _stateChangedId = 0;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();

    this._keymap = this._getKeymap();
    if (!this._keymap) {
      logger.warn('Could not read keyboard lock state from Clutter keymap', { prefix: LOG_PREFIX });
      return;
    }

    this._button = new PanelMenu.Button(0.0, 'Aurora Lock Key Indicators');
    this._button.add_style_class_name('aurora-lock-key-indicators');

    const box = new St.BoxLayout({
      style_class: 'aurora-lock-key-indicators-box',
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._capsLabel = this._makeLabel('CAPS');
    this._numLabel = this._makeLabel('NUM');
    box.add_child(this._capsLabel);
    box.add_child(this._numLabel);
    this._button.add_child(box);

    this._stateChangedId = this._keymap.connect('state-changed', () => this._sync());
    this._sync();

    Main.panel.addToStatusArea(
      STATUS_AREA_ID,
      this._button as unknown as PanelMenuButton,
      0,
      'right',
    );
  }

  override disable(): void {
    if (this._stateChangedId && this._keymap) {
      this._keymap.disconnect(this._stateChangedId);
      this._stateChangedId = 0;
    }

    (Main.panel.statusArea as Record<string, unknown>)[STATUS_AREA_ID] = null;
    this._button?.destroy();
    this._button = null;
    this._capsLabel = null;
    this._numLabel = null;
    this._keymap = null;
  }

  private _getKeymap(): Keymap | null {
    try {
      return Clutter.get_default_backend().get_default_seat().get_keymap() as unknown as Keymap;
    } catch {
      return null;
    }
  }

  private _makeLabel(text: string): St.Label {
    const label = new St.Label({
      text,
      style_class: 'aurora-lock-key-indicator',
      y_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });
    label.clutter_text.y_align = Clutter.ActorAlign.CENTER;
    return label;
  }

  private _sync(): void {
    if (!this._keymap || !this._capsLabel || !this._numLabel || !this._button) return;

    const capsActive = this._keymap.get_caps_lock_state();
    const numActive = this._keymap.get_num_lock_state();

    this._capsLabel.visible = capsActive;
    this._numLabel.visible = numActive;
    this._button.visible = capsActive || numActive;
  }
}

export const definition: ModuleDefinition = {
  key: 'lock-key-indicators',
  settingsKey: 'module-lock-key-indicators',
  section: 'dock-panel',
  title: _('Lock Key Indicators'),
  subtitle: _('Shows Caps Lock and Num Lock indicators in the top panel'),
  factory: (ctx) => new LockKeyIndicators(ctx),
};
