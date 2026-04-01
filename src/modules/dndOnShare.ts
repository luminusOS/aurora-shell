import type { ExtensionContext } from "~/core/context.ts";
import { Module } from '../module.ts';
import * as Main from '@girs/gnome-shell/ui/main';
import type { SettingsManager } from '~/core/settings.ts';

const NOTIFICATIONS_SCHEMA = 'org.gnome.desktop.notifications';
const SHOW_BANNERS_KEY = 'show-banners';

export class DndOnShare extends Module {
  private _notificationsSettings: SettingsManager | null = null;
  private _savedShowBannersState: boolean | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  private _getSharingIndicator(): any | null {
    const statusArea = Main.panel.statusArea as any;

    // GNOME Shell 49+: dedicated panel indicator for screen sharing.
    if (statusArea.screenSharing) return statusArea.screenSharing;

    // Backward-compatible fallback for older shells/extensions.
    return statusArea.quickSettings?._remoteAccess ?? null;
  }

  override enable(): void {
    const indicator = this._getSharingIndicator();

    if (indicator) {
      this._notificationsSettings = this.context.settings.getSchema(NOTIFICATIONS_SCHEMA);
      
      (indicator as any).connectObject('notify::visible', () => {
        this._syncDndState(indicator.visible);
      }, this);

      if (indicator.visible) {
        this._syncDndState(true);
      }
    } else {
      console.warn('[aurora-shell] Screen sharing indicator not found for DndOnShare module');
    }
  }

  override disable(): void {
    const indicator = this._getSharingIndicator();
    if (indicator) {
      (indicator as any).disconnectObject?.(this);
    }
    
    this._restoreState();
    this._notificationsSettings = null;
  }

  private _syncDndState(isSharing: boolean): void {
    if (!this._notificationsSettings) return;

    if (isSharing) {
      const isCurrentlyShowingBanners = this._notificationsSettings.getBoolean(SHOW_BANNERS_KEY);
      
      if (isCurrentlyShowingBanners) {
        this._savedShowBannersState = true;
        this._notificationsSettings.setBoolean(SHOW_BANNERS_KEY, false);
      } else {
        this._savedShowBannersState = null;
      }
    } else {
      this._restoreState();
    }
  }

  private _restoreState(): void {
    if (this._notificationsSettings && this._savedShowBannersState !== null) {
      this._notificationsSettings.setBoolean(SHOW_BANNERS_KEY, this._savedShowBannersState);
      this._savedShowBannersState = null;
    }
  }
}
