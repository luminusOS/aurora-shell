import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import Gio from '@girs/gio-2.0';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { SettingsManager } from '~/core/settings.ts';

const LOG_PREFIX = 'LowBatteryPercentage';
const LOW_BATTERY_PERCENT = 30;
const DESKTOP_INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const SHOW_BATTERY_PERCENTAGE_KEY = 'show-battery-percentage';
const UPOWER_BUS = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower';
const UPOWER_IFACE = 'org.freedesktop.UPower';
const UPOWER_DEVICE_IFACE = 'org.freedesktop.UPower.Device';
const DISCHARGING_STATE = 2;

export class LowBatteryPercentage extends Module {
  private _desktopSettings: SettingsManager | null = null;
  private _proxy: Gio.DBusProxy | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _managedBatteryPercentage = false;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._lifecycle = new LifecycleScope();

    this._desktopSettings = this.context.settings.getSchema(DESKTOP_INTERFACE_SCHEMA);

    this._proxy = this._createBatteryProxy();
    if (!this._proxy) {
      logger.debug('No UPower battery device found', { prefix: LOG_PREFIX });
      return;
    }

    this._lifecycle.connect(this._proxy, 'g-properties-changed', () => this._sync());
    this._sync();
  }

  override disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._proxy = null;
    this._restoreManagedBatteryPercentage();
    this._desktopSettings = null;
  }

  private _createBatteryProxy(): Gio.DBusProxy | null {
    const batteryPath = this._findBatteryPath();
    if (!batteryPath) return null;

    try {
      return Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SYSTEM,
        Gio.DBusProxyFlags.NONE,
        null,
        UPOWER_BUS,
        batteryPath,
        UPOWER_DEVICE_IFACE,
        null,
      );
    } catch (e) {
      logger.debug(`Could not create UPower device proxy: ${e}`, { prefix: LOG_PREFIX });
      return null;
    }
  }

  private _findBatteryPath(): string | null {
    try {
      const proxy = Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SYSTEM,
        Gio.DBusProxyFlags.NONE,
        null,
        UPOWER_BUS,
        UPOWER_PATH,
        UPOWER_IFACE,
        null,
      );

      const result = proxy.call_sync('EnumerateDevices', null, Gio.DBusCallFlags.NONE, 500, null);
      if (!result) return null;

      const devices = result.get_child_value(0).deep_unpack() as string[];
      const batteryPath = devices.find((path) => /battery/i.test(path));
      if (!batteryPath) return null;

      return batteryPath;
    } catch (e) {
      logger.debug(`Could not enumerate UPower devices: ${e}`, { prefix: LOG_PREFIX });
      return null;
    }
  }

  private _sync(): void {
    if (!this._proxy || !this._desktopSettings) return;

    const percentage = Number(this._proxy.get_cached_property('Percentage')?.unpack());
    const state = Number(this._proxy.get_cached_property('State')?.unpack());

    if (!Number.isFinite(percentage) || !Number.isFinite(state)) {
      this._restoreManagedBatteryPercentage();
      return;
    }

    const rounded = Math.round(percentage);
    const shouldShow = state === DISCHARGING_STATE && rounded < LOW_BATTERY_PERCENT;
    const currentlyShown = this._desktopSettings.getBoolean(SHOW_BATTERY_PERCENTAGE_KEY);

    if (shouldShow) {
      if (!currentlyShown) {
        this._desktopSettings.setBoolean(SHOW_BATTERY_PERCENTAGE_KEY, true);
        this._managedBatteryPercentage = true;
      }
      return;
    }

    if (this._managedBatteryPercentage) {
      if (currentlyShown) {
        this._desktopSettings.setBoolean(SHOW_BATTERY_PERCENTAGE_KEY, false);
      }
      this._managedBatteryPercentage = false;
    }
  }

  private _restoreManagedBatteryPercentage(): void {
    if (!this._desktopSettings || !this._managedBatteryPercentage) return;

    if (this._desktopSettings.getBoolean(SHOW_BATTERY_PERCENTAGE_KEY)) {
      this._desktopSettings.setBoolean(SHOW_BATTERY_PERCENTAGE_KEY, false);
    }
    this._managedBatteryPercentage = false;
  }
}
