// @ts-nocheck
import Clutter from '@girs/clutter-17';
import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';

const FADE_DURATION = 200;
const EASE_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;
// _rightBox is handled per-child; indicator restored explicitly after fade
const FULL_BOXES = ['_leftBox', '_centerBox'] as const;

export class PrivacyPanel extends Module {
  private _isSharing = false;
  private _indicator: any | null = null;
  private _startupCompleteId: number | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();

    const indicator = this._getSharingIndicator();

    if (!indicator) {
      console.warn('[aurora-shell] Screen sharing indicator not found for PrivacyPanel module');
      return;
    }

    this._indicator = indicator;

    indicator.connectObject('notify::visible', () => this._onSharingChanged(), this);

    Main.panel.connectObject(
      'enter-event',
      () => this._onPanelEnter(),
      'leave-event',
      () => this._onPanelLeave(),
      this,
    );

    if (indicator.visible) {
      if (this.context.shell.isStartingUp) {
        // Defer until startup animation completes — the panel reveal animation
        // re-eases boxes to opacity 255 and would override an immediate fade.
        this._startupCompleteId = this.context.shell.onStartupComplete(() => {
          this._startupCompleteId = null;
          if (this._indicator) this._onSharingChanged();
        });
      } else {
        this._onSharingChanged();
      }
    }
  }

  override disable(): void {
    if (this._startupCompleteId !== null) {
      this.context.shell.disconnect(this._startupCompleteId);
      this._startupCompleteId = null;
    }

    this._indicator?.disconnectObject?.(this);
    this._indicator = null;

    Main.panel.disconnectObject?.(this);

    this._restoreAll();
    this._isSharing = false;
  }

  private _getSharingIndicator(): any | null {
    const statusArea = Main.panel.statusArea;
    if (statusArea.screenSharing) return statusArea.screenSharing;
    return statusArea.quickSettings?._remoteAccess ?? null;
  }

  private _onSharingChanged(): void {
    this._isSharing = this._indicator?.visible ?? false;
    this._fadeContent(this._isSharing ? 0 : 255);
  }

  private _onPanelEnter(): void {
    if (!this._isSharing) return;
    this._fadeContent(255);
  }

  private _onPanelLeave(): void {
    if (!this._isSharing) return;
    if (Main.overview.visible) return;
    if (Main.panel.menuManager?.activeMenu) return;
    this._fadeContent(0);
  }

  private _fadeContent(opacity: number): void {
    for (const box of FULL_BOXES) {
      Main.panel[box]?.ease({ opacity, duration: FADE_DURATION, mode: EASE_MODE });
    }

    for (const child of Main.panel._rightBox?.get_children() ?? []) {
      child.ease({ opacity, duration: FADE_DURATION, mode: EASE_MODE });
    }

    // Always keep the sharing indicator visible regardless of its actor wrapping
    if (opacity === 0) {
      this._indicator?.ease({ opacity: 255, duration: FADE_DURATION, mode: EASE_MODE });
      this._indicator?.container?.ease({ opacity: 255, duration: FADE_DURATION, mode: EASE_MODE });
    }
  }

  private _restoreAll(): void {
    for (const box of FULL_BOXES) {
      if (Main.panel[box]) Main.panel[box].opacity = 255;
    }
    for (const child of Main.panel._rightBox?.get_children() ?? []) {
      child.opacity = 255;
    }
  }
}
