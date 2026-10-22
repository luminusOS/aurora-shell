import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';
import * as Main from '@girs/gnome-shell/ui/main';

import { attachToQuickSettings } from '~/shared/quickSettings.ts';
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
 * - The Quick Settings Dark Style toggle writes 'prefer-light' directly, inside one screen transition
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

    const detachQuickSettings = attachToQuickSettings(
      () => this._findDarkModeToggle(),
      (toggle) => this._patchDarkModeToggle(toggle),
    );
    if (!detachQuickSettings) {
      logger.error('Could not find quick settings grid', { prefix: LOG_PREFIX });
    } else {
      this._lifecycle.onDispose(detachQuickSettings);
    }

    logger.debug('Theme monitor active', { prefix: LOG_PREFIX });
  }

  override disable(): void {
    logger.debug('Disabling theme monitor', { prefix: LOG_PREFIX });

    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._settings = null;
  }

  /** Reads Shell's private `_darkMode` indicator; it has no public accessor. */
  private _findDarkModeToggle(): any | null {
    const quickSettings: any = Main.panel.statusArea.quickSettings;
    if (!quickSettings) return null;

    const darkModeIndicator = quickSettings._darkMode;
    if (!darkModeIndicator) return null;

    return darkModeIndicator.quickSettingsItems[0];
  }

  /**
   * Shell's own toggle writes `default` when turning Dark Style off, which leaves the Shell
   * stylesheet dark until `prefer-light` is written afterwards. That second write lands after the
   * screen transition has already captured its snapshot, so the Shell theme jumps instead of
   * fading. Writing `prefer-light` directly keeps the whole change under one snapshot.
   *
   * The transition must start before the write: it captures the screen as it is when it runs.
   */
  private _patchDarkModeToggle(toggle: any): void {
    if (!this._settings || !this._lifecycle) return;

    const desktopSettings = this._settings;
    const toggleMode = () => {
      Main.layoutManager.screenTransition.run();
      desktopSettings.setString('color-scheme', toggle.checked ? 'prefer-light' : 'prefer-dark');
    };

    toggle._toggleMode = toggleMode;
    this._lifecycle.onDispose(() => {
      if (toggle._toggleMode === toggleMode) delete toggle._toggleMode;
    });
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
