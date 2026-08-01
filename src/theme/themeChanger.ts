import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';

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
  private _lifecycle: LifecycleScope | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  public enable(): void {
    this.disable();
    this._lifecycle = new LifecycleScope();
    logger.debug('Initializing theme monitor', { prefix: LOG_PREFIX });

    this._settings = this.context.settings.getSchema('org.gnome.desktop.interface');

    const currentScheme = this._settings.getString('color-scheme');
    logger.debug(`Current color-scheme: ${currentScheme}`, { prefix: LOG_PREFIX });

    this._lifecycle.connect(this._settings, 'changed::color-scheme', () => {
      this._onColorSchemeChanged();
    });

    logger.debug('Theme monitor active', { prefix: LOG_PREFIX });
  }

  override disable(): void {
    logger.debug('Disabling theme monitor', { prefix: LOG_PREFIX });

    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._settings = null;
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
}
