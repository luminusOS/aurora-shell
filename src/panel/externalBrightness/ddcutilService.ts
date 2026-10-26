import '@girs/gjs';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

import { LifecycleScope } from '~/core/lifecycleScope.ts';

import {
  parseDetectedDisplays,
  type DdcDisplay,
  type DetectedDisplayTuple,
  type DisplaySelector,
} from './ddcDisplays.ts';

const BUS_NAME = 'com.ddcutil.DdcutilService';
const OBJECT_PATH = '/com/ddcutil/DdcutilObject';
const INTERFACE_NAME = 'com.ddcutil.DdcutilInterface';
const DBUS_TIMEOUT_MS = 10_000;
const BRIGHTNESS_VCP_CODE = 0x10;
const CLIENT_CONTEXT = 'aurora-shell-external-brightness';
// GDBus rejects a reply of any other type, so the unpacked values match their declared types.
const DETECTION_REPLY = '(ia(iiisssqsu)is)';
const GET_VCP_REPLY = '(qqsis)';
const SET_VCP_REPLY = '(is)';

const SERVICE_MISSING_ERRORS = [
  'org.freedesktop.DBus.Error.ServiceUnknown',
  'org.freedesktop.DBus.Error.NameHasNoOwner',
  'org.freedesktop.DBus.Error.Spawn.ExecFailed',
  'org.freedesktop.DBus.Error.Spawn.ChildExited',
  'org.freedesktop.DBus.Error.Spawn.ServiceNotFound',
  'org.freedesktop.systemd1.NoSuchUnit',
];

export type BrightnessReading = {
  current: number;
  max: number;
};

export type DetectionRequest = {
  /** Run a new detection instead of returning the service's last list, after a hotplug. */
  redetect: boolean;
  /** Allow D-Bus activation to start the service; otherwise the call fails when it is absent. */
  startService: boolean;
};

type DdcutilServiceCallbacks = {
  /** The service appeared, reported a display connection change or finished (re)initializing. */
  onDisplaysChanged: () => void;
  onServiceVanished: () => void;
  /** Another client changed a display's brightness; it may identify the display by either value. */
  onBrightnessChanged: (displayNumber: number, edid: string, value: number) => void;
};

/** True when the D-Bus error means ddcutil-service is not installed, not running or failed to start. */
export function isServiceMissingError(error: unknown): boolean {
  if (!(error instanceof GLib.Error)) return false;

  const remoteError = Gio.DBusError.get_remote_error(error);
  return remoteError !== null && SERVICE_MISSING_ERRORS.includes(remoteError);
}

export function isCancelledError(error: unknown): boolean {
  return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

function isUnknownMethodError(error: unknown): boolean {
  if (!(error instanceof GLib.Error)) return false;

  return Gio.DBusError.get_remote_error(error) === 'org.freedesktop.DBus.Error.UnknownMethod';
}

/**
 * Client for ddcutil-service on the session bus.
 *
 * Only calls made with `startService` may start the service through D-Bus activation, so a
 * service that is stopped or keeps crashing is not respawned by every refresh or slider move.
 * Pending calls are cancelled by `stop()`.
 */
export class DdcutilServiceClient {
  private _lifecycle: LifecycleScope | null = null;
  private _cancellable: Gio.Cancellable | null = null;

  constructor(private readonly _callbacks: DdcutilServiceCallbacks) {}

  start(): void {
    const lifecycle = new LifecycleScope();
    const cancellable = new Gio.Cancellable();
    lifecycle.onDispose(() => cancellable.cancel());

    const watchId = Gio.DBus.session.watch_name(
      BUS_NAME,
      Gio.BusNameWatcherFlags.NONE,
      () => this._callbacks.onDisplaysChanged(),
      () => this._callbacks.onServiceVanished(),
    );
    lifecycle.onDispose(() => Gio.DBus.session.unwatch_name(watchId));

    const subscriptionId = Gio.DBus.session.signal_subscribe(
      BUS_NAME,
      INTERFACE_NAME,
      null,
      OBJECT_PATH,
      null,
      Gio.DBusSignalFlags.NONE,
      (_connection, _sender, _path, _interface, signalName, parameters) =>
        this._handleServiceSignal(signalName, parameters),
    );
    lifecycle.onDispose(() => Gio.DBus.session.signal_unsubscribe(subscriptionId));

    this._lifecycle = lifecycle;
    this._cancellable = cancellable;
  }

  stop(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._cancellable = null;
  }

  async detectDisplays({ redetect, startService }: DetectionRequest): Promise<DdcDisplay[]> {
    // ListDetected returns the service's last detection; services older than 1.0.14 lack it.
    let method = redetect ? 'Detect' : 'ListDetected';
    let reply: GLib.Variant;
    try {
      reply = await this._call(method, new GLib.Variant('(u)', [0]), DETECTION_REPLY, startService);
    } catch (e) {
      if (method !== 'ListDetected' || !isUnknownMethodError(e)) throw e;

      method = 'Detect';
      reply = await this._call(method, new GLib.Variant('(u)', [0]), DETECTION_REPLY, startService);
    }

    const [, displays, status, message] = reply.deepUnpack() as [
      number,
      DetectedDisplayTuple[],
      number,
      string,
    ];
    if (status !== 0) throw new Error(`${method} failed with ddcutil status ${status}: ${message}`);

    return parseDetectedDisplays(displays);
  }

  async getBrightness(selector: DisplaySelector): Promise<BrightnessReading> {
    const reply = await this._call(
      'GetVcp',
      new GLib.Variant('(isyu)', [selector.displayNumber, selector.edid, BRIGHTNESS_VCP_CODE, 0]),
      GET_VCP_REPLY,
      false,
    );
    const [current, max, , status, message] = reply.deepUnpack() as [
      number,
      number,
      string,
      number,
      string,
    ];
    if (status !== 0) throw new Error(`GetVcp failed with ddcutil status ${status}: ${message}`);

    return { current, max };
  }

  async setBrightness(selector: DisplaySelector, value: number): Promise<void> {
    const reply = await this._call(
      'SetVcpWithContext',
      new GLib.Variant('(isyqsu)', [
        selector.displayNumber,
        selector.edid,
        BRIGHTNESS_VCP_CODE,
        value,
        CLIENT_CONTEXT,
        0,
      ]),
      SET_VCP_REPLY,
      false,
    );
    const [status, message] = reply.deepUnpack() as [number, string];
    if (status !== 0)
      throw new Error(`SetVcpWithContext failed with ddcutil status ${status}: ${message}`);
  }

  private _call(
    method: string,
    parameters: GLib.Variant,
    replyType: string,
    startService: boolean,
  ): Promise<GLib.Variant> {
    return Gio.DBus.session.call(
      BUS_NAME,
      OBJECT_PATH,
      INTERFACE_NAME,
      method,
      parameters,
      new GLib.VariantType(replyType),
      startService ? Gio.DBusCallFlags.NONE : Gio.DBusCallFlags.NO_AUTO_START,
      DBUS_TIMEOUT_MS,
      this._cancellable,
    );
  }

  private _handleServiceSignal(signalName: string, parameters: GLib.Variant): void {
    if (signalName === 'ConnectedDisplaysChanged' || signalName === 'ServiceInitialized') {
      this._callbacks.onDisplaysChanged();
      return;
    }

    if (signalName !== 'VcpValueChanged') return;

    const [displayNumber, edid, vcpCode, value, , context] = parameters.deepUnpack() as [
      number,
      string,
      number,
      number,
      string,
      string,
      number,
    ];
    if (vcpCode !== BRIGHTNESS_VCP_CODE || context === CLIENT_CONTEXT) return;

    this._callbacks.onBrightnessChanged(displayNumber, edid, value);
  }
}
