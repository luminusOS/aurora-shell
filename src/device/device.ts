import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';

import type { RuntimeCapability } from '~/module.ts';
import {
  createDeviceSnapshot,
  sameDeviceSnapshot,
  type DeviceSnapshot,
  type InputPresence,
  type MonitorInput,
} from '~/device/runtime.ts';

export type DeviceChangeListener = (snapshot: DeviceSnapshot) => void;

export interface DeviceService {
  readonly current: DeviceSnapshot;
  hasCapability(capability: RuntimeCapability): boolean;
  refresh(): DeviceSnapshot;
  subscribeChanged(listener: DeviceChangeListener): () => void;
  destroy(): void;
}

const SENSOR_DBUS_NAME = 'net.hadess.SensorProxy';
const SENSOR_PATH = '/net/hadess/SensorProxy';
const SENSOR_IFACE = 'net.hadess.SensorProxy';
const MODEM_MANAGER_NAME = 'org.freedesktop.ModemManager1';
const DISPLAY_CONFIG_NAME = 'org.gnome.Mutter.DisplayConfig';
const DISPLAY_CONFIG_PATH = '/org/gnome/Mutter/DisplayConfig';

export class DefaultDeviceService implements DeviceService {
  private readonly _listeners = new Set<DeviceChangeListener>();
  private readonly _seat = Clutter.get_default_backend().get_default_seat();
  private _monitorChangedId: number | null;
  private _deviceAddedId: number | null;
  private _deviceRemovedId: number | null;
  private _nameWatchIds: number[] | null;
  private _snapshot: DeviceSnapshot;

  constructor() {
    this._snapshot = this._detect();
    this._monitorChangedId = Main.layoutManager.connect('monitors-changed', () => this.refresh());
    this._deviceAddedId = this._seat.connect('device-added', () => this.refresh());
    this._deviceRemovedId = this._seat.connect('device-removed', () => this.refresh());
    this._nameWatchIds = [SENSOR_DBUS_NAME, MODEM_MANAGER_NAME].map((name) =>
      Gio.bus_watch_name(
        Gio.BusType.SYSTEM,
        name,
        Gio.BusNameWatcherFlags.NONE,
        () => this.refresh(),
        () => this.refresh(),
      ),
    );
  }

  get current(): DeviceSnapshot {
    return this._snapshot;
  }

  hasCapability(capability: RuntimeCapability): boolean {
    return this._snapshot.capabilities.has(capability);
  }

  refresh(): DeviceSnapshot {
    if (!this._nameWatchIds) return this._snapshot;
    const next = this._detect();
    if (!sameDeviceSnapshot(this._snapshot, next)) {
      this._snapshot = next;
      for (const listener of this._listeners) listener(next);
    }
    return this._snapshot;
  }

  subscribeChanged(listener: DeviceChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  destroy(): void {
    if (!this._nameWatchIds) return;
    if (this._monitorChangedId !== null) Main.layoutManager.disconnect(this._monitorChangedId);
    if (this._deviceAddedId !== null) this._seat.disconnect(this._deviceAddedId);
    if (this._deviceRemovedId !== null) this._seat.disconnect(this._deviceRemovedId);
    for (const id of this._nameWatchIds) Gio.bus_unwatch_name(id);
    this._monitorChangedId = null;
    this._deviceAddedId = null;
    this._deviceRemovedId = null;
    this._nameWatchIds = null;
    this._listeners.clear();
  }

  private _detect(): DeviceSnapshot {
    const input = this._detectInputPresence(this._seat.list_devices());
    const capabilities = this._detectCapabilities(input.touch);
    return createDeviceSnapshot(this._detectMonitors(), input, capabilities);
  }

  private _detectMonitors(): MonitorInput[] {
    const builtinMonitorIndices = this._detectBuiltinMonitorIndices();
    return (Main.layoutManager.monitors ?? []).map((monitor) => ({
      index: monitor.index,
      x: monitor.x,
      y: monitor.y,
      width: monitor.width,
      height: monitor.height,
      scale: monitor.geometryScale,
      isBuiltin: builtinMonitorIndices.has(monitor.index),
    }));
  }

  private _detectInputPresence(devices: readonly Clutter.InputDevice[]): InputPresence {
    return {
      touch: devices.some(
        (device) => device.get_device_type() === Clutter.InputDeviceType.TOUCHSCREEN_DEVICE,
      ),
      pointer: devices.some(
        (device) => device.get_device_type() === Clutter.InputDeviceType.POINTER_DEVICE,
      ),
      keyboard: devices.some(
        (device) => device.get_device_type() === Clutter.InputDeviceType.KEYBOARD_DEVICE,
      ),
    };
  }

  private _detectCapabilities(hasTouch: boolean): ReadonlySet<RuntimeCapability> {
    const capabilities = new Set<RuntimeCapability>();
    if (hasTouch) capabilities.add('touch');
    if (this._hasBacklight()) capabilities.add('backlight');
    if (this._hasDBusNameOwner(MODEM_MANAGER_NAME)) capabilities.add('cellular');

    const sensorProxy = this._getSensorProxy();
    if (sensorProxy) {
      if (this._getBooleanProperty(sensorProxy, 'HasAccelerometer'))
        capabilities.add('accelerometer');
      if (this._getBooleanProperty(sensorProxy, 'HasAmbientLight'))
        capabilities.add('light-sensor');
      if (this._getBooleanProperty(sensorProxy, 'HasProximity'))
        capabilities.add('proximity-sensor');
    }
    return capabilities;
  }

  private _detectBuiltinMonitorIndices(): ReadonlySet<number> {
    try {
      const result = Gio.DBus.session.call_sync(
        DISPLAY_CONFIG_NAME,
        DISPLAY_CONFIG_PATH,
        DISPLAY_CONFIG_NAME,
        'GetCurrentState',
        null,
        null,
        Gio.DBusCallFlags.NONE,
        200,
        null,
      );
      return this._parseBuiltinMonitorIndices(result?.recursiveUnpack<unknown>());
    } catch {
      return new Set();
    }
  }

  private _parseBuiltinMonitorIndices(state: unknown): ReadonlySet<number> {
    if (!Array.isArray(state) || !Array.isArray(state[1]) || !Array.isArray(state[2]))
      return new Set();

    const builtinConnectors = new Set<string>();
    for (const physical of state[1]) {
      if (!Array.isArray(physical) || !Array.isArray(physical[0])) continue;
      const connector = physical[0][0];
      const properties = physical[2];
      if (
        typeof connector === 'string' &&
        this._isRecord(properties) &&
        properties['is-builtin'] === true
      )
        builtinConnectors.add(connector);
    }

    const indices = new Set<number>();
    for (const [index, logical] of state[2].entries()) {
      if (!Array.isArray(logical) || !Array.isArray(logical[5])) continue;
      const containsBuiltin = logical[5].some(
        (spec) => Array.isArray(spec) && builtinConnectors.has(spec[0]),
      );
      if (containsBuiltin) indices.add(index);
    }
    return indices;
  }

  private _isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private _hasBacklight(): boolean {
    try {
      const dir = Gio.File.new_for_path('/sys/class/backlight');
      const enumerator = dir.enumerate_children(
        'standard::name',
        Gio.FileQueryInfoFlags.NONE,
        null,
      );
      try {
        return enumerator.next_file(null) !== null;
      } finally {
        enumerator.close(null);
      }
    } catch {
      return false;
    }
  }

  private _getSensorProxy(): Gio.DBusProxy | null {
    if (!this._hasDBusNameOwner(SENSOR_DBUS_NAME)) return null;
    try {
      return Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SYSTEM,
        Gio.DBusProxyFlags.NONE,
        null,
        SENSOR_DBUS_NAME,
        SENSOR_PATH,
        SENSOR_IFACE,
        null,
      );
    } catch {
      return null;
    }
  }

  private _getBooleanProperty(proxy: Gio.DBusProxy, propertyName: string): boolean {
    return Boolean(proxy.get_cached_property(propertyName)?.unpack());
  }

  private _hasDBusNameOwner(name: string): boolean {
    try {
      const result = Gio.DBus.system.call_sync(
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus',
        'NameHasOwner',
        new GLib.Variant('(s)', [name]),
        new GLib.VariantType('(b)'),
        Gio.DBusCallFlags.NONE,
        200,
        null,
      );
      return Boolean(result?.get_child_value(0).unpack());
    } catch {
      return false;
    }
  }
}
