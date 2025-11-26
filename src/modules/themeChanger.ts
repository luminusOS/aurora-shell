import '@girs/gjs';

import Gio from "gi://Gio";
import { Module } from './module.ts';

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
  private _settings: any;
  private _signalId: number | null = null;

  public enable(): void {
    console.log('Initializing theme monitor');

    try {
      this._settings = new Gio.Settings({
        schema_id: 'org.gnome.desktop.interface'
      });
      
      const currentScheme = this._settings.get_string('color-scheme');
      console.log(`Current color-scheme: ${currentScheme}`);

      this._signalId = this._settings.connect('changed::color-scheme', () => {
        this._onColorSchemeChanged();
      });

      console.log('Theme monitor active');
    } catch (error) {
      console.error('Failed to initialize:', error);
    }
  }

  private _onColorSchemeChanged(): void {
    const scheme = this._settings.get_string('color-scheme');
    console.log(`Color scheme changed to: ${scheme}`);
    
    if (scheme === 'default') {
      console.warn('Detected "default", forcing to prefer-light');
      this._settings.set_string('color-scheme', 'prefer-light');
      return;
    }
  }

  override disable(): void {
    console.log('Disabling theme monitor');

    if (this._signalId && this._settings) {
      this._settings.disconnect(this._signalId);
      this._signalId = null;
    }

    this._settings = null;
  }
}
