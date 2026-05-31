import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';
import { getSharingIndicator } from '~/modules/privacy/sharingIndicator.ts';

const NOTIFICATIONS_SCHEMA = 'org.gnome.desktop.notifications';
const SHOW_BANNERS_KEY = 'show-banners';
const LOG_PREFIX = 'DndOnShare';

export class DndOnShare extends Module {
  private _notificationsSettings: SettingsManager | null = null;
  private _savedShowBannersState: boolean | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    const indicator = getSharingIndicator();

    if (indicator) {
      this._notificationsSettings = this.context.settings.getSchema(NOTIFICATIONS_SCHEMA);

      (indicator as any).connectObject(
        'notify::visible',
        () => {
          this._syncDndState(indicator.visible);
        },
        this,
      );

      if (indicator.visible) {
        this._syncDndState(true);
      }
    } else {
      logger.warn('Screen sharing indicator not found', { prefix: LOG_PREFIX });
    }
  }

  override disable(): void {
    const indicator = getSharingIndicator();
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
