import '@girs/gjs';
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';

/**
 * AutoThemeSwitcher Module
 *
 * Switches GNOME's color-scheme between prefer-light and prefer-dark at
 * user-configured fixed times. Applies the correct theme immediately on
 * enable and reschedules precisely at each boundary using a single-shot
 * GLib timer. Subscribes to PrepareForSleep to reset the timer after
 * system suspend, since GLib monotonic timers pause during sleep.
 */
export class AutoThemeSwitcher extends Module {
  private _sourceId: number | null = null;
  private _subscribeId: number | null = null;
  private _desktopSettings: SettingsManager | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    try {
      this._desktopSettings = this.context.settings.getSchema('org.gnome.desktop.interface');
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
    const light = this._parseTime(
      this.context.settings.getString('auto-theme-switcher-light-time'),
    );
    const dark = this._parseTime(this.context.settings.getString('auto-theme-switcher-dark-time'));

    if (light === null || dark === null) return;

    const isLight =
      light < dark ? current >= light && current < dark : current >= light || current < dark;

    const scheme = isLight ? 'prefer-light' : 'prefer-dark';
    this._desktopSettings.setString('color-scheme', scheme);
    this.context.logger.debug(`AutoThemeSwitcher: applied ${scheme}`);

    let next = isLight ? dark : light;
    if (next <= current) next += 1440;
    const delay = (next - current) * 60 - now.getSeconds();

    this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
      this._tick();
      return GLib.SOURCE_REMOVE;
    });
  }

  private _parseTime(s: string): number | null {
    const match = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!match || match[1] === undefined || match[2] === undefined) {
      this.context.logger.warn(`AutoThemeSwitcher: invalid time "${s}", expected HH:MM`);
      return null;
    }
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h > 23 || m > 59) {
      this.context.logger.warn(`AutoThemeSwitcher: out-of-range time "${s}"`);
      return null;
    }
    return h * 60 + m;
  }
}
