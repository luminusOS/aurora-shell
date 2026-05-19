import '@girs/gjs';
import { gettext as _ } from 'gettext';

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';
import type { ModuleDefinition } from '~/module.ts';

const LOG_PREFIX = 'ThemeChanger';

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
    logger.debug('Initializing theme monitor22222', { prefix: LOG_PREFIX });

    try {
      this._settings = this.context.settings.getSchema('org.gnome.desktop.interface');

      const currentScheme = this._settings.getString('color-scheme');
      logger.debug(`Current color-scheme: ${currentScheme}`, { prefix: LOG_PREFIX });

      this._signalId = this._settings.connect('changed::color-scheme', () => {
        this._onColorSchemeChanged();
      });

      logger.debug('Theme monitor active', { prefix: LOG_PREFIX });
    } catch (error) {
      logger.error('Failed to initialize:', { prefix: LOG_PREFIX }, error);
    }
  }

  private _onColorSchemeChanged(): void {
    if (!this._settings) return;

    const scheme = this._settings.getString('color-scheme');
    logger.debug(`Color scheme changed to: ${scheme}`, { prefix: LOG_PREFIX });

    if (scheme === 'default') {
      logger.log('Detected "default", forcing to prefer-light', { prefix: LOG_PREFIX });
      this._settings.setString('color-scheme', 'prefer-light');
      return;
    }
  }

  override disable(): void {
    logger.debug('Disabling theme monitor', { prefix: LOG_PREFIX });

    if (this._signalId && this._settings) {
      this._settings.disconnect(this._signalId);
      this._signalId = null;
    }

    this._settings = null;
  }
}

export const definition: ModuleDefinition = {
  key: 'theme-changer',
  settingsKey: 'module-theme-changer',
  title: _('Theme Changer'),
  subtitle: _('Monitors and synchronizes GNOME color scheme'),
  factory: (ctx) => new ThemeChanger(ctx),
};
