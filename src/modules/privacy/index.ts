import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import { DndOnShare } from '~/modules/privacy/dndOnShare.ts';
import { PrivacyPanel } from '~/modules/privacy/privacyPanel.ts';

const DND_KEY = 'privacy-dnd-on-share';
const PANEL_KEY = 'privacy-panel';

export class PrivacyModule extends Module {
  private _dndOnShare: DndOnShare | null = null;
  private _privacyPanel: PrivacyPanel | null = null;
  private _settingsIds: number[] = [];

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();

    this._applyDnd();
    this._applyPanel();

    const settings = this.context.settings;
    this._settingsIds = [
      settings.connect(`changed::${DND_KEY}`, () => this._applyDnd()),
      settings.connect(`changed::${PANEL_KEY}`, () => this._applyPanel()),
    ];
  }

  override disable(): void {
    for (const id of this._settingsIds) {
      this.context.settings.disconnect(id);
    }
    this._settingsIds = [];

    this._dndOnShare?.disable();
    this._dndOnShare = null;
    this._privacyPanel?.disable();
    this._privacyPanel = null;
  }

  private _applyDnd(): void {
    const enabled = this.context.settings.getBoolean(DND_KEY);
    if (enabled && !this._dndOnShare) {
      this._dndOnShare = new DndOnShare(this.context);
      this._dndOnShare.enable();
    } else if (!enabled && this._dndOnShare) {
      this._dndOnShare.disable();
      this._dndOnShare = null;
    }
  }

  private _applyPanel(): void {
    const enabled = this.context.settings.getBoolean(PANEL_KEY);
    if (enabled && !this._privacyPanel) {
      this._privacyPanel = new PrivacyPanel(this.context);
      this._privacyPanel.enable();
    } else if (!enabled && this._privacyPanel) {
      this._privacyPanel.disable();
      this._privacyPanel = null;
    }
  }
}
