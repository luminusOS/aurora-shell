import '@girs/gjs';

import type { ExtensionContext } from "~/core/context.ts";
import { Module } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';

/**
 * ThemeChanger Module
 * 
 * Monitors the Dark Style toggle and synchronizes it with GNOME's color-scheme setting.
 * - When Dark Style is enabled → sets 'prefer-dark'
 * - When Dark Style is disabled → 'default' → forces to 'prefer-light'
 * 
 * This ensures consistent theming across GNOME Shell and applications.
 */
export class ThemeChanger extends Module {
  private _settings: SettingsManager | null = null;
  private _signalId: number | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  public enable(): void {
    this.context.logger.debug('Initializing theme monitor22222');

    try {
      this._settings = this.context.settings.getSchema('org.gnome.desktop.interface');

      const currentScheme = this._settings.getString('color-scheme');
      this.context.logger.debug(`Current color-scheme: ${currentScheme}`);

      this._signalId = this._settings.connect('changed::color-scheme', () => {
        this._onColorSchemeChanged();
      });

      this.context.logger.debug('Theme monitor active');
    } catch (error) {
      this.context.logger.error('Failed to initialize:', error);
    }
  }

  private _onColorSchemeChanged(): void {
    if (!this._settings) return;

    const scheme = this._settings.getString('color-scheme');
    this.context.logger.debug(`Color scheme changed to: ${scheme}`);

    if (scheme === 'default') {
      this.context.logger.warn('Detected "default", forcing to prefer-light');
      this._settings.setString('color-scheme', 'prefer-light');
      return;
    }
  }

  override disable(): void {
    this.context.logger.debug('Disabling theme monitor');

    if (this._signalId && this._settings) {
      this._settings.disconnect(this._signalId);
      this._signalId = null;
    }

    this._settings = null;
  }
}
