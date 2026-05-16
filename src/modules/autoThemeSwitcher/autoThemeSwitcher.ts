// @ts-nocheck
import '@girs/gjs';
import { gettext as _ } from 'gettext';
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';
import type { ModuleDefinition } from '~/moduleDefinition.ts';

/**
 * AutoThemeSwitcher Module
 *
 * Switches GNOME's color-scheme between prefer-light and prefer-dark at
 * user-configured fixed times. Applies the correct theme immediately on
 * enable and reschedules precisely at each boundary using a single-shot
 * GLib timer. Subscribes to PrepareForSleep to reset the timer after
 * system suspend, since GLib monotonic timers pause during sleep.
 */
const TIME_KEYS = [
  'auto-theme-switcher-light-hours',
  'auto-theme-switcher-light-minutes',
  'auto-theme-switcher-dark-hours',
  'auto-theme-switcher-dark-minutes',
] as const;

export class AutoThemeSwitcher extends Module {
  private _sourceId: number | null = null;
  private _subscribeId: number | null = null;
  private _settingsIds: number[] = [];
  private _desktopSettings: SettingsManager | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    try {
      this._desktopSettings = this.context.settings.getSchema('org.gnome.desktop.interface');
      for (const key of TIME_KEYS) {
        this._settingsIds.push(
          this.context.settings.connect(`changed::${key}`, () => this._tick()),
        );
      }
      this._subscribeId = Gio.DBus.system.signal_subscribe(
        'org.freedesktop.login1',
        'org.freedesktop.login1.Manager',
        'PrepareForSleep',
        '/org/freedesktop/login1',
        null,
        Gio.DBusSignalFlags.NONE,
        (_conn, _sender, _path, _iface, _signal, params) => {
          const [sleeping] = params.deep_unpack() as [boolean];
          if (!sleeping) {
            if (this._sourceId !== null) {
              GLib.Source.remove(this._sourceId);
              this._sourceId = null;
            }
            this._tick();
          }
        },
      );
      this._tick();
    } catch (error) {
      this.context.logger.error('AutoThemeSwitcher: Failed to enable:', error);
    }
  }

  override disable(): void {
    if (this._sourceId !== null) {
      GLib.Source.remove(this._sourceId);
      this._sourceId = null;
    }
    for (const id of this._settingsIds) {
      this.context.settings.disconnect(id);
    }
    this._settingsIds = [];
    if (this._subscribeId !== null) {
      Gio.DBus.system.signal_unsubscribe(this._subscribeId);
      this._subscribeId = null;
    }
    this._desktopSettings = null;
  }

  private _tick(): void {
    if (this._sourceId !== null) {
      GLib.Source.remove(this._sourceId);
      this._sourceId = null;
    }
    if (!this._desktopSettings) return;

    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const light =
      this.context.settings.getInt('auto-theme-switcher-light-hours') * 60 +
      this.context.settings.getInt('auto-theme-switcher-light-minutes');
    const dark =
      this.context.settings.getInt('auto-theme-switcher-dark-hours') * 60 +
      this.context.settings.getInt('auto-theme-switcher-dark-minutes');

    const isLight =
      light < dark ? current >= light && current < dark : current >= light || current < dark;

    const scheme = isLight ? 'prefer-light' : 'prefer-dark';
    const current_scheme = this._desktopSettings.getString('color-scheme');

    if (current_scheme !== scheme) {
      this._desktopSettings.setString('color-scheme', scheme);
      this.context.logger.debug(`AutoThemeSwitcher: applied ${scheme}`);
    } else {
      this.context.logger.debug(`AutoThemeSwitcher: already on ${scheme}`);
    }

    let next = isLight ? dark : light;
    if (next <= current) next += 1440;
    const delay = (next - current) * 60 - now.getSeconds();

    this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
      this._tick();
      return GLib.SOURCE_REMOVE;
    });
  }
}

export const definition: ModuleDefinition = {
  key: 'auto-theme-switcher',
  settingsKey: 'module-auto-theme-switcher',
  title: _('Auto Theme Switcher'),
  subtitle: _('Automatically switches between light and dark theme based on time'),
  options: [
    {
      hourKey: 'auto-theme-switcher-light-hours',
      minuteKey: 'auto-theme-switcher-light-minutes',
      title: _('Light Time'),
      subtitle: _('Time to switch to light theme (HH:MM)'),
      type: 'time',
    },
    {
      hourKey: 'auto-theme-switcher-dark-hours',
      minuteKey: 'auto-theme-switcher-dark-minutes',
      title: _('Dark Time'),
      subtitle: _('Time to switch to dark theme (HH:MM)'),
      type: 'time',
    },
  ],
  factory: (ctx) => new AutoThemeSwitcher(ctx),
};
