import '@girs/gjs';
import { gettext as _ } from 'gettext';

import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import St from '@girs/st-18';
import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';

const LOG_PREFIX = 'LowBatteryPercentage';
const LOW_BATTERY_PERCENT = 20;
const UPOWER_BUS = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower';
const UPOWER_IFACE = 'org.freedesktop.UPower';
const UPOWER_DEVICE_IFACE = 'org.freedesktop.UPower.Device';
const DISCHARGING_STATE = 2;

export class LowBatteryPercentage extends Module {
  private _label: St.Label | null = null;
  private _proxy: Gio.DBusProxy | null = null;
  private _propertiesChangedId = 0;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();

    this._label = new St.Label({
      style_class: 'aurora-low-battery-percentage',
      y_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });
    this._label.clutter_text.y_align = Clutter.ActorAlign.CENTER;

    Main.panel.statusArea.quickSettings?._indicators?.add_child(this._label);

    this._proxy = this._createBatteryProxy();
    if (!this._proxy) {
      this._label.visible = false;
      logger.debug('No UPower battery device found', { prefix: LOG_PREFIX });
      return;
    }

    this._propertiesChangedId = this._proxy.connect('g-properties-changed', () => this._sync());
    this._sync();
  }

  override disable(): void {
    if (this._propertiesChangedId && this._proxy) {
      this._proxy.disconnect(this._propertiesChangedId);
      this._propertiesChangedId = 0;
    }

    this._proxy = null;
    this._label?.destroy();
    this._label = null;
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
      const devices = (result?.get_child_value(0).deep_unpack() as string[] | undefined) ?? [];
      return devices.find((path) => /battery/i.test(path)) ?? null;
    } catch (e) {
      logger.debug(`Could not enumerate UPower devices: ${e}`, { prefix: LOG_PREFIX });
      return null;
    }
  }

  private _sync(): void {
    if (!this._proxy || !this._label) return;

    const percentage = Number(this._proxy.get_cached_property('Percentage')?.unpack());
    const state = Number(this._proxy.get_cached_property('State')?.unpack());

    if (!Number.isFinite(percentage) || !Number.isFinite(state)) {
      this._label.visible = false;
      return;
    }

    const rounded = Math.round(percentage);
    this._label.text = `${rounded}%`;
    this._label.visible = state === DISCHARGING_STATE && rounded < LOW_BATTERY_PERCENT;
  }
}

export const definition: ModuleDefinition = {
  key: 'low-battery-percentage',
  settingsKey: 'module-low-battery-percentage',
  section: 'dock-panel',
  title: _('Low Battery Percentage'),
  subtitle: _('Shows battery percentage in the panel while below 20%'),
  factory: (ctx) => new LowBatteryPercentage(ctx),
};
