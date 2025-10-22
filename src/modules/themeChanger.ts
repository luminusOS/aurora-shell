import '@girs/gjs';

import Gio from "gi://Gio";
import * as Main from '@girs/gnome-shell/ui/main';
import { BaseModule } from './baseModule';

/**
 * ThemeChanger Module
 * 
 * Monitors the Dark Style toggle and synchronizes it with GNOME's color-scheme setting.
 * - When Dark Style is enabled → sets 'prefer-dark' → adds 'aurora-dark-mode' class
 * - When Dark Style is disabled → 'default' → forces to 'prefer-light'
 * 
 * This ensures the Aurora Shell panel colors only apply in dark mode.
 */
export class ThemeChanger extends BaseModule {
  private _settings: any;
  private _signalId: number | null = null;

  public enable(): void {
    this.log('Initializing theme monitor');

    try {
      this._settings = new Gio.Settings({
        schema_id: 'org.gnome.desktop.interface'
      });
      
      const currentScheme = this._settings.get_string('color-scheme');
      this.log(`Current color-scheme: ${currentScheme}`);
      this._applyThemeClass(currentScheme);

      this._signalId = this._settings.connect('changed::color-scheme', () => {
        this._onColorSchemeChanged();
      });

      this.log('Theme monitor active');
    } catch (error) {
      this.error('Failed to initialize:', error);
    }
  }

  private _onColorSchemeChanged(): void {
    const scheme = this._settings.get_string('color-scheme');
    this.log(`Color scheme changed to: ${scheme}`);
    
    if (scheme === 'default') {
      this.log('Detected "default", forcing to prefer-light');
      this._settings.set_string('color-scheme', 'prefer-light');
      return;
    }
    
    this._applyThemeClass(scheme);
  }

  private _applyThemeClass(scheme: string): void {
    const panel = Main.panel;
    
    if (scheme === 'prefer-dark') {
      this.log('Dark mode active - panel colors enabled');
      panel.add_style_class_name('aurora-dark-mode');
      panel.remove_style_class_name('aurora-light-mode');
    } else if (scheme === 'prefer-light' || scheme === 'default') {
      this.log('Light mode active - panel colors disabled');
      panel.remove_style_class_name('aurora-dark-mode');
      panel.add_style_class_name('aurora-light-mode');
    }
  }

  setDarkMode(): void {
    if (this._settings) {
      this.log('Switching to dark mode');
      this._settings.set_string('color-scheme', 'prefer-dark');
    }
  }

  setLightMode(): void {
    if (this._settings) {
      this.log('Switching to light mode');
      this._settings.set_string('color-scheme', 'prefer-light');
    }
  }

  toggleMode(): void {
    if (!this._settings) return;

    const current = this._settings.get_string('color-scheme');
    if (current === 'prefer-dark') {
      this.setLightMode();
    } else {
      this.setDarkMode();
    }
  }

  getCurrentScheme(): string {
    if (!this._settings) return 'unknown';
    return this._settings.get_string('color-scheme');
  }

  isDarkMode(): boolean {
    const scheme = this.getCurrentScheme();
    return scheme === 'prefer-dark';
  }

  isLightMode(): boolean {
    const scheme = this.getCurrentScheme();
    return scheme === 'prefer-light' || scheme === 'default';
  }

  disable(): void {
    this.log('Disabling theme monitor');

    const panel = Main.panel;
    panel.remove_style_class_name('aurora-dark-mode');
    panel.remove_style_class_name('aurora-light-mode');

    if (this._signalId && this._settings) {
      this._settings.disconnect(this._signalId);
      this._signalId = null;
    }

    this._settings = null;
  }
}
