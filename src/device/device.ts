import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
import Meta from '@girs/meta-18';

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

export class DefaultDeviceService implements DeviceService {
  private readonly _listeners = new Set<DeviceChangeListener>();
  private readonly _seat = global.stage.context.get_backend().get_default_seat();
  private _monitorChangedId: number | null;
  private _deviceAddedId: number | null;
  private _deviceRemovedId: number | null;
  private _sensorWatchId: number | null = null;
  private _modemManagerWatchId: number | null = null;
  private _sensorOwner: string | null = null;
  private _modemManagerOwned = false;
  private _sensorProxyRequest: Gio.Cancellable | null = null;
  private _sensorProxy: Gio.DBusProxy | null = null;
  private _sensorPropertiesChangedId: number | null = null;
  private _refreshLaterId: number | null = null;
  private _snapshot: DeviceSnapshot;

  constructor() {
    this._snapshot = this._detect();
    this._monitorChangedId = Main.layoutManager.connect('monitors-changed', () =>
      this._queueRefresh(),
    );
    this._deviceAddedId = this._seat.connect('device-added', () => this._queueRefresh());
    this._deviceRemovedId = this._seat.connect('device-removed', () => this._queueRefresh());

    this._sensorWatchId = Gio.bus_watch_name(
      Gio.BusType.SYSTEM,
      SENSOR_DBUS_NAME,
      Gio.BusNameWatcherFlags.NONE,
      (_connection, _name, owner) => this._sensorAppeared(owner),
      () => this._sensorVanished(),
    );
    this._modemManagerWatchId = Gio.bus_watch_name(
      Gio.BusType.SYSTEM,
      MODEM_MANAGER_NAME,
      Gio.BusNameWatcherFlags.NONE,
      () => {
        this._modemManagerOwned = true;
        this._queueRefresh();
      },
      () => {
        this._modemManagerOwned = false;
        this._queueRefresh();
      },
    );
  }

  get current(): DeviceSnapshot {
    return this._snapshot;
  }

  hasCapability(capability: RuntimeCapability): boolean {
    return this._snapshot.capabilities.has(capability);
  }

  refresh(): DeviceSnapshot {
    if (this._sensorWatchId === null || this._modemManagerWatchId === null) return this._snapshot;

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
    if (this._sensorWatchId === null || this._modemManagerWatchId === null) return;

    if (this._refreshLaterId !== null) {
      global.compositor.get_laters().remove(this._refreshLaterId);
      this._refreshLaterId = null;
    }

    Gio.bus_unwatch_name(this._sensorWatchId);
    Gio.bus_unwatch_name(this._modemManagerWatchId);
    this._sensorWatchId = null;
    this._modemManagerWatchId = null;

    this._sensorOwner = null;
    this._modemManagerOwned = false;
    if (this._sensorProxyRequest) {
      this._sensorProxyRequest.cancel();
      this._sensorProxyRequest = null;
    }
    this._clearSensorProxy();

    if (this._monitorChangedId !== null) Main.layoutManager.disconnect(this._monitorChangedId);
    if (this._deviceAddedId !== null) this._seat.disconnect(this._deviceAddedId);
    if (this._deviceRemovedId !== null) this._seat.disconnect(this._deviceRemovedId);
    this._monitorChangedId = null;
    this._deviceAddedId = null;
    this._deviceRemovedId = null;
    this._listeners.clear();
  }

  private _detect(): DeviceSnapshot {
    const input = this._detectInputPresence(this._seat.list_devices());
    const capabilities = this._detectCapabilities(input.touch);
    return createDeviceSnapshot(this._detectMonitors(), input, capabilities);
  }

  private _detectMonitors(): MonitorInput[] {
    const builtinMonitorIndices = this._detectBuiltinMonitorIndices();
    return (Main.layoutManager.monitors || []).map((monitor) => ({
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
    if (this._modemManagerOwned) capabilities.add('cellular');

    if (this._sensorProxy) {
      if (this._getBooleanProperty(this._sensorProxy, 'HasAccelerometer'))
        capabilities.add('accelerometer');
      if (this._getBooleanProperty(this._sensorProxy, 'HasAmbientLight'))
        capabilities.add('light-sensor');
      if (this._getBooleanProperty(this._sensorProxy, 'HasProximity'))
        capabilities.add('proximity-sensor');
    }
    return capabilities;
  }

  private _detectBuiltinMonitorIndices(): ReadonlySet<number> {
    const logicalMonitors = global.backend.get_monitor_manager().get_logical_monitors();
    const indices = new Set<number>();
    if (!logicalMonitors) return indices;

    for (const logicalMonitor of logicalMonitors) {
      if (logicalMonitor.get_monitors().some((monitor) => monitor.is_builtin()))
        indices.add(logicalMonitor.get_number());
    }
    return indices;
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

  private _sensorAppeared(owner: string): void {
    if (this._sensorWatchId === null) return;

    this._sensorOwner = owner;
    if (this._sensorProxyRequest) this._sensorProxyRequest.cancel();
    this._sensorProxyRequest = new Gio.Cancellable();
    this._clearSensorProxy();
    this._queueRefresh();

    const sensorProxyRequest = this._sensorProxyRequest;
    Gio.DBusProxy.new_for_bus(
      Gio.BusType.SYSTEM,
      Gio.DBusProxyFlags.NONE,
      null,
      owner,
      SENSOR_PATH,
      SENSOR_IFACE,
      sensorProxyRequest,
      (_source, result) => {
        let proxy: Gio.DBusProxy;
        try {
          proxy = Gio.DBusProxy.new_for_bus_finish(result);
        } catch {
          if (this._sensorProxyRequest === sensorProxyRequest) this._sensorProxyRequest = null;
          return;
        }

        if (this._sensorProxyRequest !== sensorProxyRequest || this._sensorOwner !== owner) return;

        this._sensorProxyRequest = null;
        this._sensorProxy = proxy;
        this._sensorPropertiesChangedId = proxy.connect('g-properties-changed', () =>
          this._queueRefresh(),
        );
        this._queueRefresh();
      },
    );
  }

  private _sensorVanished(): void {
    if (this._sensorWatchId === null) return;

    this._sensorOwner = null;
    if (this._sensorProxyRequest) {
      this._sensorProxyRequest.cancel();
      this._sensorProxyRequest = null;
    }
    this._clearSensorProxy();
    this._queueRefresh();
  }

  private _queueRefresh(): void {
    if (this._sensorWatchId === null || this._refreshLaterId !== null) return;

    this._refreshLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
      this._refreshLaterId = null;
      this.refresh();
      return false;
    });
  }

  private _clearSensorProxy(): void {
    if (this._sensorProxy && this._sensorPropertiesChangedId !== null)
      this._sensorProxy.disconnect(this._sensorPropertiesChangedId);
    this._sensorProxy = null;
    this._sensorPropertiesChangedId = null;
  }

  private _getBooleanProperty(proxy: Gio.DBusProxy, propertyName: string): boolean {
    return Boolean(proxy.get_cached_property(propertyName)?.unpack());
  }
}
