import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
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
const LIGHT_HOURS_KEY = 'auto-theme-switcher-light-hours';
const LIGHT_MINUTES_KEY = 'auto-theme-switcher-light-minutes';
const DARK_HOURS_KEY = 'auto-theme-switcher-dark-hours';
const DARK_MINUTES_KEY = 'auto-theme-switcher-dark-minutes';
const LOG_PREFIX = 'AutoThemeSwitcher';

export class AutoThemeSwitcher extends Module {
  private _scheduledTick: ManagedSource | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _desktopSettings: SettingsManager | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._lifecycle = new LifecycleScope();
    this._scheduledTick = createManagedSource(this._lifecycle);
    this._desktopSettings = this.context.settings.getSchema('org.gnome.desktop.interface');

    const settings = this.context.settings;
    this._lifecycle.connect(settings, `changed::${LIGHT_HOURS_KEY}`, () => this._tick());
    this._lifecycle.connect(settings, `changed::${LIGHT_MINUTES_KEY}`, () => this._tick());
    this._lifecycle.connect(settings, `changed::${DARK_HOURS_KEY}`, () => this._tick());
    this._lifecycle.connect(settings, `changed::${DARK_MINUTES_KEY}`, () => this._tick());

    const subscriptionId = Gio.DBus.system.signal_subscribe(
      'org.freedesktop.login1',
      'org.freedesktop.login1.Manager',
      'PrepareForSleep',
      '/org/freedesktop/login1',
      null,
      Gio.DBusSignalFlags.NONE,
      (_conn, _sender, _path, _iface, _signal, params) => {
        const [sleeping] = params.deep_unpack() as [boolean];
        if (!sleeping) this._tick();
      },
    );
    this._lifecycle.onDispose(() => Gio.DBus.system.signal_unsubscribe(subscriptionId));
    this._tick();
  }

  override disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._scheduledTick = null;
    this._desktopSettings = null;
  }

  private _tick(): void {
    const scheduledTick = this._scheduledTick;
    if (!scheduledTick || !this._desktopSettings) return;

    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const light =
      this.context.settings.getInt(LIGHT_HOURS_KEY) * 60 +
      this.context.settings.getInt(LIGHT_MINUTES_KEY);
    const dark =
      this.context.settings.getInt(DARK_HOURS_KEY) * 60 +
      this.context.settings.getInt(DARK_MINUTES_KEY);

    const isLight =
      light < dark ? current >= light && current < dark : current >= light || current < dark;

    const scheme = isLight ? 'prefer-light' : 'prefer-dark';
    const currentScheme = this._desktopSettings.getString('color-scheme');

    if (currentScheme !== scheme) {
      this._desktopSettings.setString('color-scheme', scheme);
      logger.debug(`applied ${scheme}`, { prefix: LOG_PREFIX });
    } else {
      logger.debug(`already on ${scheme}`, { prefix: LOG_PREFIX });
    }

    let next = isLight ? dark : light;
    if (next <= current) next += 1440;
    const delay = (next - current) * 60 - now.getSeconds();

    scheduledTick.replace(() =>
      GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
        scheduledTick.complete();
        this._tick();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }
}
