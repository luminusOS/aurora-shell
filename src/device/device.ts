import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import type { RuntimeCapability, RuntimeTarget } from '~/module.ts';

export type DeviceSnapshot = {
  readonly target: RuntimeTarget;
  readonly capabilities: ReadonlySet<RuntimeCapability>;
};

export type DeviceChangeListener = (snapshot: DeviceSnapshot) => void;

export interface DeviceService {
  readonly current: DeviceSnapshot;
  hasCapability(capability: RuntimeCapability): boolean;
  refresh(): DeviceSnapshot;
  subscribeChanged(listener: DeviceChangeListener): () => void;
}

const SENSOR_DBUS_NAME = 'net.hadess.SensorProxy';
const SENSOR_PATH = '/net/hadess/SensorProxy';
const SENSOR_IFACE = 'net.hadess.SensorProxy';
const MODEM_MANAGER_NAME = 'org.freedesktop.ModemManager1';

export class DefaultDeviceService implements DeviceService {
  private readonly _target: RuntimeTarget;
  private readonly _listeners = new Set<DeviceChangeListener>();
  private _snapshot: DeviceSnapshot;

  constructor(target: RuntimeTarget = 'desktop') {
    this._target = target;
    this._snapshot = this._detect();
  }

  get current(): DeviceSnapshot {
    return this._snapshot;
  }

  hasCapability(capability: RuntimeCapability): boolean {
    return this._snapshot.capabilities.has(capability);
  }

  refresh(): DeviceSnapshot {
    const next = this._detect();
    if (!sameSnapshot(this._snapshot, next)) {
      this._snapshot = next;
      for (const listener of this._listeners) listener(next);
    }
    return this._snapshot;
  }

  subscribeChanged(listener: DeviceChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _detect(): DeviceSnapshot {
    return {
      target: this._target,
      capabilities: detectCapabilities(),
    };
  }
}

function detectCapabilities(): ReadonlySet<RuntimeCapability> {
  const capabilities = new Set<RuntimeCapability>();

  if (hasTouchInput()) capabilities.add('touch');
  if (hasBacklight()) capabilities.add('backlight');
  if (hasAlertSlider()) capabilities.add('hardware-alert-slider');
  if (hasDBusNameOwner(MODEM_MANAGER_NAME)) capabilities.add('cellular');

  const sensorProxy = getSensorProxy();
  if (sensorProxy) {
    if (getBooleanProperty(sensorProxy, 'HasAccelerometer')) capabilities.add('accelerometer');
    if (getBooleanProperty(sensorProxy, 'HasAmbientLight')) capabilities.add('light-sensor');
    if (getBooleanProperty(sensorProxy, 'HasProximity')) capabilities.add('proximity-sensor');
  }

  return capabilities;
}

function hasTouchInput(): boolean {
  try {
    const devices = Clutter.get_default_backend().get_default_seat().list_devices();
    return devices.some(
      (device) => device.get_device_type() === Clutter.InputDeviceType.TOUCHSCREEN_DEVICE,
    );
  } catch {
    return false;
  }
}

function hasAlertSlider(): boolean {
  // This needs a device-specific input backend. Do not scan /proc synchronously
  // during Shell startup just to discover an optional hardware switch.
  return false;
}

function hasBacklight(): boolean {
  try {
    const dir = Gio.File.new_for_path('/sys/class/backlight');
    const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    try {
      return enumerator.next_file(null) !== null;
    } finally {
      enumerator.close(null);
    }
  } catch {
    return false;
  }
}

function getSensorProxy(): Gio.DBusProxy | null {
  if (!hasDBusNameOwner(SENSOR_DBUS_NAME)) return null;

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

function getBooleanProperty(proxy: Gio.DBusProxy, propertyName: string): boolean {
  try {
    return Boolean(proxy.get_cached_property(propertyName)?.unpack());
  } catch {
    return false;
  }
}

function hasDBusNameOwner(name: string): boolean {
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

function sameSnapshot(a: DeviceSnapshot, b: DeviceSnapshot): boolean {
  if (a.target !== b.target) return false;
  if (a.capabilities.size !== b.capabilities.size) return false;
  for (const capability of a.capabilities) {
    if (!b.capabilities.has(capability)) return false;
  }
  return true;
}
