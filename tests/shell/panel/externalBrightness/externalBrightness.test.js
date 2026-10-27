/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { QuickSlider } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {
  EXTENSION_UUID,
  getAuroraSettings,
  waitForCondition,
  waitForExtension,
  waitForModuleState,
  waitForTiming,
} from '../../support/testUtils.js';

const BUS_NAME = 'com.ddcutil.DdcutilService';
const OBJECT_PATH = '/com/ddcutil/DdcutilObject';
const INTERFACE_NAME = 'com.ddcutil.DdcutilInterface';
const AURORA_CONTEXT = 'aurora-shell-external-brightness';
const BRIGHTNESS = 0x10;
// Mirrors WRITE_SPACING_MS in externalBrightness.ts, minus timer jitter.
const MIN_WRITE_GAP_MS = 140;

const DETECTION_ARGS = `
      <arg name="flags" type="u" direction="in"/>
      <arg name="number_of_displays" type="i" direction="out"/>
      <arg name="detected_displays" type="a(iiisssqsu)" direction="out"/>
      <arg name="error_status" type="i" direction="out"/>
      <arg name="error_message" type="s" direction="out"/>`;

const SERVICE_XML = `
<node>
  <interface name="${INTERFACE_NAME}">
    <method name="Detect">${DETECTION_ARGS}
    </method>
    <method name="ListDetected">${DETECTION_ARGS}
    </method>
    <method name="GetVcp">
      <arg name="display_number" type="i" direction="in"/>
      <arg name="edid_txt" type="s" direction="in"/>
      <arg name="vcp_code" type="y" direction="in"/>
      <arg name="flags" type="u" direction="in"/>
      <arg name="vcp_current_value" type="q" direction="out"/>
      <arg name="vcp_max_value" type="q" direction="out"/>
      <arg name="vcp_formatted_value" type="s" direction="out"/>
      <arg name="error_status" type="i" direction="out"/>
      <arg name="error_message" type="s" direction="out"/>
    </method>
    <method name="SetVcpWithContext">
      <arg name="display_number" type="i" direction="in"/>
      <arg name="edid_txt" type="s" direction="in"/>
      <arg name="vcp_code" type="y" direction="in"/>
      <arg name="vcp_new_value" type="q" direction="in"/>
      <arg name="client_context" type="s" direction="in"/>
      <arg name="flags" type="u" direction="in"/>
      <arg name="error_status" type="i" direction="out"/>
      <arg name="error_message" type="s" direction="out"/>
    </method>
    <signal name="VcpValueChanged">
      <arg name="display_number" type="i"/>
      <arg name="edid_txt" type="s"/>
      <arg name="vcp_code" type="y"/>
      <arg name="vcp_new_value" type="q"/>
      <arg name="source_client_name" type="s"/>
      <arg name="source_client_context" type="s"/>
      <arg name="flags" type="u"/>
    </signal>
  </interface>
</node>`;

const ServiceEvents = GObject.registerClass(
  {
    Signals: {
      'vcp-set': {},
      'detection-called': {},
      'read-called': {},
      'calibration-changed': {},
    },
  },
  class ServiceEvents extends GObject.Object {},
);

const NativeScale = GObject.registerClass(
  {
    Properties: {
      value: GObject.ParamSpec.double('value', null, null, GObject.ParamFlags.READWRITE, 0, 1, 0.8),
    },
  },
  class NativeScale extends GObject.Object {
    get name() {
      return 'Built-in Display';
    }

    get monitor() {
      return global.backend.get_monitor_manager().get_logical_monitors()[0];
    }
  },
);

/**
 * In-process stand-in for ddcutil-service, owned on the test's private session bus. Like the real
 * service, ListDetected returns the last detection and only Detect sees newly connected displays.
 */
class FakeDdcutilService {
  constructor(displays) {
    this.connected = displays;
    this.detected = [...displays];
    this.calls = { Detect: 0, ListDetected: 0 };
    this.writes = [];
    this.holdListing = false;
    this.pendingListing = null;
    // Services older than 1.0.14 have no ListDetected and answer it with UnknownMethod.
    this.listDetectedMissing = false;
    this.holdWrite = false;
    this.pendingWrite = null;
    this.holdRead = false;
    this.pendingRead = null;
    this.pendingReadReply = null;
    this.events = new ServiceEvents();
    this._exported = Gio.DBusExportedObject.wrapJSObject(SERVICE_XML, this);
    this._exported.export(Gio.DBus.session, OBJECT_PATH);
    this._ownerId = 0;
  }

  own() {
    return new Promise((resolve, reject) => {
      this._ownerId = Gio.bus_own_name_on_connection(
        Gio.DBus.session,
        BUS_NAME,
        Gio.BusNameOwnerFlags.NONE,
        () => resolve(),
        () => reject(new Error(`Could not own ${BUS_NAME}`)),
      );
    });
  }

  unown() {
    if (this._ownerId) Gio.bus_unown_name(this._ownerId);
    this._ownerId = 0;
  }

  destroy() {
    this.unown();
    this._exported.unexport();
  }

  get detectionCalls() {
    return this.calls.Detect + this.calls.ListDetected;
  }

  Detect(_flags) {
    this.calls.Detect++;
    this.detected = [...this.connected];
    this.events.emit('detection-called');
    return this._detectionReply();
  }

  _listDetected(_flags) {
    this.calls.ListDetected++;
    this.events.emit('detection-called');
    return this._detectionReply();
  }

  ListDetectedAsync([flags], invocation) {
    if (this.listDetectedMissing) {
      this.calls.ListDetected++;
      invocation.return_dbus_error(
        'org.freedesktop.DBus.Error.UnknownMethod',
        'No such method ListDetected',
      );
      return;
    }
    if (this.holdListing) {
      this.calls.ListDetected++;
      this.pendingListing = invocation;
      this.events.emit('detection-called');
      return;
    }
    invocation.return_value(new GLib.Variant('(ia(iiisssqsu)is)', this._listDetected(flags)));
  }

  releaseListing() {
    this.holdListing = false;
    this.pendingListing.return_value(new GLib.Variant('(ia(iiisssqsu)is)', this._detectionReply()));
    this.pendingListing = null;
  }

  _detectionReply() {
    const tuples = this.detected.map((display) => [
      display.number,
      0,
      0,
      display.vendor,
      display.model,
      display.serial,
      display.productCode,
      display.edid,
      display.binarySerial,
    ]);
    return [tuples.length, tuples, 0, ''];
  }

  _getVcp(displayNumber, edid, _code, _flags) {
    const display = this.connected.find((candidate) =>
      edid ? candidate.edid === edid : candidate.number === displayNumber,
    );
    if (!display || !display.readable) return [0, 0, '', -3005, 'DDC communication failed'];

    return [display.brightness, display.max, String(display.brightness), 0, ''];
  }

  GetVcpAsync(parameters, invocation) {
    const reply = this._getVcp(...parameters);
    if (this.holdRead) {
      this.pendingRead = invocation;
      this.pendingReadReply = reply;
      this.events.emit('read-called');
      return;
    }
    invocation.return_value(new GLib.Variant('(qqsis)', reply));
  }

  releaseRead(maximum) {
    this.holdRead = false;
    this.pendingReadReply[1] = maximum;
    this.pendingRead.return_value(new GLib.Variant('(qqsis)', this.pendingReadReply));
    this.pendingRead = null;
    this.pendingReadReply = null;
  }

  _setVcp(displayNumber, edid, code, value, context, _flags) {
    const display = this.connected.find((candidate) =>
      edid ? candidate.edid === edid : candidate.number === displayNumber,
    );
    if (display) display.brightness = value;

    this.writes.push({
      displayNumber,
      edid,
      code,
      value,
      context,
      time: GLib.get_monotonic_time() / 1000,
    });
    this.events.emit('vcp-set');
    return [0, ''];
  }

  SetVcpWithContextAsync(parameters, invocation) {
    if (this.holdWrite) this.pendingWrite = invocation;
    const reply = this._setVcp(...parameters);
    if (!this.holdWrite) invocation.return_value(new GLib.Variant('(is)', reply));
  }

  releaseWrite() {
    this.holdWrite = false;
    this.pendingWrite.return_value(new GLib.Variant('(is)', [0, '']));
    this.pendingWrite = null;
  }

  emitBrightnessChange(display, value) {
    display.brightness = value;
    this._exported.emit_signal(
      'VcpValueChanged',
      new GLib.Variant('(isyqssu)', [
        display.number,
        display.edid,
        BRIGHTNESS,
        value,
        ':1.99',
        'other',
        0,
      ]),
    );
  }
}

function quickSettingsMenu() {
  return Main.panel.statusArea.quickSettings.menu;
}

// The bundler renames registered classes, so sliders are recognised by their label's style class.
function displayNameLabel(item) {
  const content = item.get_child();
  if (!content) return null;

  const label = content.get_first_child();
  if (!label || !label.has_style_class_name('aurora-external-brightness-label')) return null;

  return label;
}

function brightnessSliders() {
  return allBrightnessSliders().filter((slider) => sliderLabel(slider) !== 'Built-in Display');
}

function allBrightnessSliders() {
  const master = masterSlider();
  if (!master) return [];
  return master.menu
    ._getMenuItems()
    .flatMap((item) =>
      item
        .get_children()
        .filter((child) => child instanceof QuickSlider && displayNameLabel(child)),
    );
}

function masterSlider() {
  return quickSettingsMenu()
    ._grid.get_children()
    .find(
      (child) =>
        child instanceof QuickSlider &&
        child.has_style_class_name('aurora-external-brightness-master'),
    );
}

const CALIBRATION_PATH = '/org/gnome/Shell/Extensions/AuroraShell/Brightness';
const CALIBRATION_INTERFACE = 'org.gnome.Shell.Extensions.AuroraShell.Brightness';
const calibrationEvents = new ServiceEvents();
let calibrationState = [];

function calibrationCall(method, parameters = null) {
  return Gio.DBus.session.call(
    'org.gnome.Shell',
    CALIBRATION_PATH,
    CALIBRATION_INTERFACE,
    method,
    parameters,
    null,
    Gio.DBusCallFlags.NO_AUTO_START,
    5000,
    null,
  );
}

async function calibrationTargets() {
  const reply = await calibrationCall('GetTargets');
  const [targets] = reply.deepUnpack();
  return targets.map(([displayId, name, mode, reportedMax, min, max, available]) => ({
    displayId,
    name,
    mode,
    reportedMax,
    min,
    max,
    available,
  }));
}

async function calibrationTarget(name) {
  const target = (await calibrationTargets()).find((item) => item.name === name);
  if (!target) throw new Error(`No calibration target for ${name}`);
  return target;
}

/** Saves a profile the way the preferences do, and waits for the Shell to report it. */
async function saveCalibration(settings, target, mode, min = 0, max = 0) {
  const others = settings
    .get_strv('external-brightness-calibrations')
    .filter((entry) => !entry.startsWith(`${target.displayId}:`));
  const entry = [target.displayId, mode, min, max, target.reportedMax].join(':');
  settings.set_strv(
    'external-brightness-calibrations',
    mode === 'reported' ? others : [...others, entry],
  );
  await waitForCondition({
    evaluate: () =>
      calibrationState.some(
        (item) =>
          item.displayId === target.displayId &&
          item.mode === mode &&
          (mode !== 'manual' || (item.min === min && item.max === max)),
      ),
    signals: [[calibrationEvents, 'calibration-changed']],
    description: `the Shell to apply the ${mode} profile of ${target.name}`,
  });
}

async function captureBrightnessUi(path) {
  await waitForTiming(500, 'animation: let the brightness controls finish opening');
  const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
  try {
    await new Shell.Screenshot().screenshot(false, stream);
  } finally {
    stream.close(null);
  }
}

/** The id a calibration profile is stored under: a SHA-256 of the monitor model, not its EDID. */
function modelId(display) {
  const model = [display.vendor, display.productCode, display.model].join('\n');
  return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, model, -1);
}

function sliderLabel(slider) {
  return displayNameLabel(slider).text;
}

async function waitForSliderCount(count, description) {
  if (count > 0) {
    await waitForCondition({
      evaluate: () => masterSlider(),
      signals: [[quickSettingsMenu()._grid, 'child-added']],
      description: 'the master slider to appear',
    });
  }
  const master = masterSlider();
  await waitForCondition({
    evaluate: () => brightnessSliders().length === count,
    signals: master
      ? [
          [master.menu.box, 'child-added'],
          [master.menu.box, 'child-removed'],
        ]
      : [],
    description,
  });
  if (count > 0) {
    calibrationState = await calibrationTargets();
    await waitForCondition({
      evaluate: () =>
        calibrationState.length === count && calibrationState.every((item) => item.available),
      signals: [[calibrationEvents, 'calibration-changed']],
      description: 'display enumeration to finish before using its controls',
    });
  }
}

function assertSlidersFollowGnomeSliders() {
  const first = masterSlider();
  const previous = first.get_previous_sibling();
  if (!(previous instanceof QuickSlider))
    throw new Error('External brightness sliders are not placed right after GNOME’s own sliders');

  if (!first.menuEnabled) throw new Error('The master has no menu arrow');
}

export var METRICS = {};

export function init() {
  Scripting.defineScriptEvent(
    'slidersMatchDisplays',
    'Sliders match readable displays, names and placement',
  );
  Scripting.defineScriptEvent(
    'writesCoalesced',
    'Slider moves write serially, spaced, ending at the latest value',
  );
  Scripting.defineScriptEvent(
    'osdTargetsMatchedMonitor',
    'Moving a slider shows the OSD on its own monitor only',
  );
  Scripting.defineScriptEvent(
    'externalChangeShown',
    'Brightness changed by another client updates the slider',
  );
  Scripting.defineScriptEvent(
    'hotplugRedetects',
    'A monitor change runs a new detection and adds the new display',
  );
  Scripting.defineScriptEvent(
    'vanishDoesNotRespawn',
    'Losing the service removes sliders without calling it',
  );
  Scripting.defineScriptEvent(
    'disableReleasesUi',
    'Disabling the module removes sliders and their menus',
  );
  Scripting.defineScriptEvent(
    'startsServiceOnce',
    'Only the first listing after enable may start the service',
  );
  Scripting.defineScriptEvent(
    'calibrationPersists',
    'Calibration profiles survive a module restart and can be reset',
  );
}

export async function run() {
  await waitForExtension(EXTENSION_UUID);
  const settings = getAuroraSettings();
  const originalEnabled = settings.get_boolean('module-external-brightness');
  settings.reset('external-brightness-calibrations');
  const nativeScale = new NativeScale();
  let nativeScales = [nativeScale];
  const manager = Main.brightnessManager;
  Object.defineProperty(manager, 'scales', { configurable: true, get: () => nativeScales });
  Object.defineProperty(manager, 'globalScale', {
    configurable: true,
    get: () => nativeScales[0] || null,
  });
  manager.emit('changed');
  const nativeSlider = Main.panel.statusArea.quickSettings._brightness.quickSettingsItems[0];
  const nativeVisibleBefore = nativeSlider.visible;
  const monitorManager = global.backend.get_monitor_manager();

  const monitor = monitorManager.get_monitors()[0];
  if (!monitor) throw new Error('The test needs at least one monitor');
  if (monitor.get_display_name() === monitor.get_product())
    throw new Error(
      'This session cannot tell a Settings name from an EDID model; name matching would be unproven',
    );

  const matched = {
    number: 1,
    vendor: monitor.get_vendor(),
    model: monitor.get_product(),
    serial: monitor.get_serial(),
    productCode: 0,
    edid: 'EDID-MATCHED',
    binarySerial: 0,
    brightness: 40,
    max: 100,
    readable: true,
  };
  const unmatched = {
    number: 2,
    vendor: 'TST',
    model: 'TEST-27',
    serial: 'S27',
    productCode: 0x27,
    edid: 'EDID-UNMATCHED',
    binarySerial: 27,
    brightness: 10,
    max: 50,
    readable: true,
  };
  const unreadable = {
    ...unmatched,
    number: 3,
    model: 'NO-DDC',
    serial: 'S0',
    edid: 'EDID-UNREADABLE',
    readable: false,
  };
  const hotplugged = {
    ...unmatched,
    number: 4,
    model: 'HOTPLUG-24',
    serial: 'S24',
    edid: 'EDID-HOTPLUG',
    brightness: 5,
  };

  const overlay = quickSettingsMenu()._overlay;
  const overlayChildrenBefore = overlay.get_n_children();
  const osdCalls = [];
  const originalShowOsd = Main.osdWindowManager.show;
  Main.osdWindowManager.show = function (icon, label, levels) {
    osdCalls.push(Object.keys(levels).map(Number));
    return originalShowOsd.call(this, icon, label, levels);
  };

  // Records the module's calls to the service, which go through the promisified
  // DBusConnection.call, to check which ones were allowed to start it through D-Bus activation.
  const serviceCalls = [];
  const originalCall = Gio.DBusConnection.prototype.call;
  Gio.DBusConnection.prototype.call = function (
    busName,
    objectPath,
    interfaceName,
    method,
    parameters,
    replyType,
    flags,
    ...rest
  ) {
    if (busName === BUS_NAME) serviceCalls.push({ method, flags });
    return originalCall.call(
      this,
      busName,
      objectPath,
      interfaceName,
      method,
      parameters,
      replyType,
      flags,
      ...rest,
    );
  };
  const originalGetMonitors = monitorManager.get_monitors;

  const service = new FakeDdcutilService([matched, unmatched, unreadable]);
  const calibrationSubscription = Gio.DBus.session.signal_subscribe(
    'org.gnome.Shell',
    CALIBRATION_INTERFACE,
    'Changed',
    CALIBRATION_PATH,
    null,
    Gio.DBusSignalFlags.NONE,
    () => {
      calibrationTargets()
        .then((targets) => {
          calibrationState = targets;
          calibrationEvents.emit('calibration-changed');
        })
        .catch(() => {
          calibrationState = [];
        });
    },
  );
  try {
    await service.own();

    settings.set_boolean('module-external-brightness', true);
    await waitForModuleState(settings, 'module-external-brightness', 'external-brightness', true);
    await waitForSliderCount(2, 'a slider for each readable display');

    const [matchedSlider, unmatchedSlider] = brightnessSliders();
    if (sliderLabel(matchedSlider) !== monitor.get_display_name())
      throw new Error(
        `Matched slider is named "${sliderLabel(matchedSlider)}", not "${monitor.get_display_name()}"`,
      );
    if (sliderLabel(unmatchedSlider) !== 'TEST-27')
      throw new Error(
        `Unmatched slider is named "${sliderLabel(unmatchedSlider)}", not its EDID model`,
      );
    if (
      Math.abs(matchedSlider.slider.value - 0.4) > 0.001 ||
      Math.abs(unmatchedSlider.slider.value - 0.2) > 0.001
    )
      throw new Error('Sliders do not show the brightness read from the displays');
    assertSlidersFollowGnomeSliders();
    if (
      masterSlider()
        .menu._getMenuItems()
        .some((item) => item.label && /Calibrat|configur/iu.test(item.label.text))
    )
      throw new Error('Calibration actions remain in Quick Settings');
    if (Math.abs(masterSlider().slider.value - 0.8) > 0.001)
      throw new Error('The unified master does not show the highest brightness');
    if (nativeSlider.visible) throw new Error('The native brightness slider was not replaced');
    if (allBrightnessSliders().length !== 3)
      throw new Error('The internal display is missing from the unified submenu');
    const screenshotPath = GLib.getenv('AURORA_BRIGHTNESS_SCREENSHOT');
    if (screenshotPath) quickSettingsMenu().open();
    masterSlider()._menuButton.emit('clicked', 1);
    if (!masterSlider().menu.isOpen) throw new Error('The arrow did not open the monitor menu');
    if (screenshotPath) await captureBrightnessUi(screenshotPath);
    masterSlider().menu.close();
    Scripting.scriptEvent('slidersMatchDisplays');

    for (const position of [0.5, 0.6, 0.7, 0.8, 0.9]) matchedSlider.slider.value = position;
    await waitForCondition({
      evaluate: () => service.writes.some(({ value }) => value === 90),
      signals: [[service.events, 'vcp-set']],
      description: 'the latest slider position to reach the display',
    });
    await waitForTiming(
      400,
      'negative check: no write may follow the latest value after the write spacing delay',
    );

    const writtenValues = service.writes.map(({ value }) => value);
    if (writtenValues.length !== 2 || writtenValues[0] !== 50 || writtenValues[1] !== 90)
      throw new Error(
        `Slider moves were not coalesced to the first and latest value: ${JSON.stringify(writtenValues)}`,
      );
    const gap = service.writes[1].time - service.writes[0].time;
    if (gap < MIN_WRITE_GAP_MS)
      throw new Error(`Consecutive writes were only ${gap.toFixed(0)} ms apart`);
    if (
      service.writes.some(
        ({ edid, code, context }) =>
          edid !== matched.edid || code !== BRIGHTNESS || context !== AURORA_CONTEXT,
      )
    )
      throw new Error(`Unexpected brightness write: ${JSON.stringify(service.writes)}`);
    Scripting.scriptEvent('writesCoalesced');

    const matchedMonitorIndex = monitorManager.get_monitor_for_connector(monitor.get_connector());
    if (
      osdCalls.length === 0 ||
      osdCalls.some((indices) => indices.length !== 1 || indices[0] !== matchedMonitorIndex)
    )
      throw new Error(
        `OSD was shown on ${JSON.stringify(osdCalls)}, expected only monitor ${matchedMonitorIndex}`,
      );
    osdCalls.length = 0;
    unmatchedSlider.slider.value = 0.3;
    await waitForCondition({
      evaluate: () => service.writes.some(({ edid }) => edid === unmatched.edid),
      signals: [[service.events, 'vcp-set']],
      description: 'the unmatched display to receive its write',
    });
    if (osdCalls.length !== 0)
      throw new Error('OSD was shown for a display without a matching monitor');
    Scripting.scriptEvent('osdTargetsMatchedMonitor');

    service.emitBrightnessChange(unmatched, 25);
    await waitForCondition({
      evaluate: () => Math.abs(unmatchedSlider.slider.value - 0.5) < 0.001,
      signals: [[unmatchedSlider.slider, 'notify::value']],
      description: 'the slider to follow a change made by another client',
    });
    if (service.writes.filter(({ edid }) => edid === unmatched.edid).length !== 1)
      throw new Error('Showing an external change wrote brightness back to the display');
    Scripting.scriptEvent('externalChangeShown');

    unmatchedSlider.slider.emit('drag-begin');
    service.emitBrightnessChange(unmatched, 20);
    await waitForTiming(
      200,
      'negative check: external changes stay deferred while a drag is in progress',
    );
    if (Math.abs(unmatchedSlider.slider.value - 0.5) > 0.001)
      throw new Error('An external update moved the slider during a drag');
    unmatchedSlider.slider.emit('drag-end');
    if (Math.abs(masterSlider().slider.value - 0.9) > 0.001)
      throw new Error('The master remained stale after a deferred drag update');

    const writesBeforeMaster = service.writes.length;
    osdCalls.length = 0;
    masterSlider().slider.value = 0.6;
    // Each OSD call hides the OSD on the monitors it leaves out, so the master needs exactly one.
    if (osdCalls.length !== 1 || !osdCalls[0].includes(matchedMonitorIndex))
      throw new Error(`The master showed the OSD as ${JSON.stringify(osdCalls)}`);
    await waitForCondition({
      // From 90% to 60%: every display drops by the same 30 points (90/40/80 -> 60/10/50).
      evaluate: () => matched.brightness === 60 && unmatched.brightness === 5,
      signals: [[service.events, 'vcp-set']],
      description: 'the master to move every external display by the same difference',
    });
    if (service.writes.length !== writesBeforeMaster + 2)
      throw new Error('The master wrote to an unexpected display');
    if (
      Math.abs(matchedSlider.slider.value - 0.6) > 0.001 ||
      Math.abs(unmatchedSlider.slider.value - 0.1) > 0.001
    )
      throw new Error('Individual sliders did not follow the master');
    if (Math.abs(nativeScale.value - 0.5) > 0.001)
      throw new Error('The internal display did not move by the master difference');
    const internalSlider = allBrightnessSliders().find(
      (slider) => sliderLabel(slider) === 'Built-in Display',
    );
    internalSlider.slider.value = 0.7;
    if (Math.abs(nativeScale.value - 0.7) > 0.001 || matched.brightness !== 60)
      throw new Error('The internal display cannot be adjusted independently');

    masterSlider().slider.value = 0;
    await waitForCondition({
      evaluate: () => matched.brightness === 0 && unmatched.brightness === 0,
      signals: [[service.events, 'vcp-set']],
      description: 'the combined master to lower every display to zero',
    });
    if (nativeScale.value !== 0) throw new Error('The built-in display did not reach zero');
    // Regression: after zero, 100% on the master left the built-in display at its old ratio.
    masterSlider().slider.value = 1;
    await waitForCondition({
      evaluate: () => matched.brightness === 100 && unmatched.brightness === 50,
      signals: [[service.events, 'vcp-set']],
      description: 'the master at 100% to raise every display to its maximum',
    });
    if (nativeScale.value !== 1) throw new Error('The built-in display stayed below 100%');
    masterSlider().slider.value = 0.26;
    await waitForCondition({
      evaluate: () => matched.brightness === 26 && unmatched.brightness === 13,
      signals: [[service.events, 'vcp-set']],
      description: 'the master to lower every display by the same difference from 100%',
    });
    if (Math.abs(nativeScale.value - 0.26) > 0.001)
      throw new Error('The built-in display did not move by the master difference');

    await waitForTiming(
      400,
      'delay: allow the final serialized write to finish before calibration',
    );
    const writesBeforeCalibration = service.writes.length;
    const calibration = await calibrationTarget('TEST-27');
    await saveCalibration(settings, calibration, 'manual', 5, 35);
    await waitForCondition({
      evaluate: () => Math.abs(unmatchedSlider.slider.value - 8 / 30) < 0.001,
      signals: [[unmatchedSlider.slider, 'notify::value']],
      description: 'the calibrated slider to normalize its observed raw value',
    });
    if (service.writes.length !== writesBeforeCalibration)
      throw new Error('Applying calibration wrote to the monitor');
    unmatchedSlider.slider.value = 1;
    await waitForCondition({
      evaluate: () => unmatched.brightness === 35,
      signals: [[service.events, 'vcp-set']],
      description: 'the calibrated individual slider to respect the manual maximum',
    });
    masterSlider().slider.value = 0.2;
    await waitForCondition({
      evaluate: () => unmatched.brightness === 11,
      signals: [[service.events, 'vcp-set']],
      description: 'the master to use the calibrated range',
    });
    if (
      service.writes
        .slice(writesBeforeCalibration)
        .some(({ edid, value }) => edid === unmatched.edid && (value < 5 || value > 35))
    )
      throw new Error('A calibrated write escaped the approved range');

    const maximumChange = await calibrationTarget('TEST-27');
    service.holdRead = true;
    await saveCalibration(settings, maximumChange, 'manual', 6, 35);
    await waitForCondition({
      evaluate: () => service.pendingRead !== null,
      signals: [[service.events, 'read-called']],
      description: 'the post-apply brightness read to remain in flight',
    });
    unmatchedSlider.slider.value = 0.8;
    unmatched.max = 60;
    service.releaseRead(60);
    await waitForCondition({
      evaluate: () => !unmatchedSlider.slider.reactive,
      signals: [[unmatchedSlider.slider, 'notify::reactive']],
      description: 'a maximum change discovered by post-apply readback to suspend calibration',
    });
    unmatched.max = 50;

    // A hotplug is a change in the set of connectors; other monitor changes only re-list.
    const listCallsBeforeRelist = service.calls.ListDetected;
    const detectCallsBeforeRelist = service.calls.Detect;
    Main.layoutManager.emit('monitors-changed');
    await waitForCondition({
      evaluate: () => service.calls.ListDetected > listCallsBeforeRelist,
      signals: [[service.events, 'detection-called']],
      description: 'a monitor change without a new connector to re-list displays',
    });
    if (service.calls.Detect !== detectCallsBeforeRelist)
      throw new Error('A monitor change without a new connector ran a full DDC detection');
    await waitForSliderCount(2, 'the re-listing to finish');
    if (!unmatchedSlider.slider.reactive)
      throw new Error('The stored range did not return once the monitor reported its maximum');
    const restored = await calibrationTarget('TEST-27');
    if (restored.mode !== 'manual' || restored.min !== 6 || restored.max !== 35)
      throw new Error(`The stored calibration was not restored: ${JSON.stringify(restored)}`);
    unmatchedSlider.slider.value = 0.95;
    await waitForCondition({
      evaluate: () => unmatched.brightness === 34,
      signals: [[service.events, 'vcp-set']],
      description: 'the restored calibration to map the slider into the stored range',
    });

    // GNOME only controls the backlight of an active monitor, so a backlight on an inactive one
    // must not hide that display's DDC/CI slider.
    let backlightMonitorActive = false;
    const backlightMonitor = {
      get_vendor: () => unmatched.vendor,
      get_product: () => unmatched.model,
      get_serial: () => unmatched.serial,
      get_display_name: () => 'TEST-27',
      get_connector: () => 'eDP-99',
      get_backlight: () => ({}),
      is_active: () => backlightMonitorActive,
    };
    monitorManager.get_monitors = () => [
      ...originalGetMonitors.call(monitorManager),
      backlightMonitor,
    ];
    const detectCallsBeforeBacklight = service.calls.Detect;
    Main.layoutManager.emit('monitors-changed');
    await waitForCondition({
      evaluate: () => service.calls.Detect > detectCallsBeforeBacklight,
      signals: [[service.events, 'detection-called']],
      description: 'the backlight monitor to be detected',
    });
    await waitForSliderCount(2, 'an inactive backlight to leave the DDC/CI slider in place');
    backlightMonitorActive = true;
    const listCallsBeforeActive = service.calls.ListDetected;
    Main.layoutManager.emit('monitors-changed');
    await waitForCondition({
      evaluate: () => service.calls.ListDetected > listCallsBeforeActive,
      signals: [[service.events, 'detection-called']],
      description: 'the activated backlight monitor to be re-listed',
    });
    await waitForSliderCount(1, 'an active backlight to leave the display to GNOME');
    monitorManager.get_monitors = originalGetMonitors;
    const detectCallsBeforeRemoval = service.calls.Detect;
    Main.layoutManager.emit('monitors-changed');
    await waitForCondition({
      evaluate: () => service.calls.Detect > detectCallsBeforeRemoval,
      signals: [[service.events, 'detection-called']],
      description: 'the backlight monitor removal to be detected',
    });
    await waitForSliderCount(2, 'the display to get its DDC/CI slider back');

    service.connected = [matched, unmatched, unreadable, hotplugged];
    const hotplugMonitor = {
      get_vendor: () => hotplugged.vendor,
      get_product: () => 'Unrelated product',
      get_serial: () => 'Unrelated serial',
      get_display_name: () => 'Hotplugged monitor',
      get_connector: () => 'DP-99',
      get_backlight: () => null,
      is_active: () => true,
    };
    monitorManager.get_monitors = () => [
      ...originalGetMonitors.call(monitorManager),
      hotplugMonitor,
    ];
    const detectCallsBefore = service.calls.Detect;
    Main.layoutManager.emit('monitors-changed');
    await waitForSliderCount(3, 'the hotplugged display to get a slider');
    if (service.calls.Detect === detectCallsBefore)
      throw new Error('A monitor change did not run a new detection');
    if (sliderLabel(brightnessSliders()[2]) !== 'HOTPLUG-24')
      throw new Error('The hotplugged display has the wrong slider');
    if (brightnessSliders()[0] !== matchedSlider)
      throw new Error('A refresh replaced the slider of a display that stayed');
    Scripting.scriptEvent('hotplugRedetects');

    const twinA = { ...unmatched, number: 5, edid: 'EDID-TWINS', model: 'TWIN', brightness: 10 };
    const twinB = { ...twinA, number: 6, brightness: 20 };
    service.connected.push(twinA, twinB);
    service.detected = [...service.connected];
    Main.layoutManager.emit('monitors-changed');
    await waitForSliderCount(5, 'both identical-EDID displays to have individual controls');
    const twins = brightnessSliders().filter((slider) => sliderLabel(slider).startsWith('TWIN'));
    twins[0].slider.value = 0.8;
    await waitForCondition({
      evaluate: () => twinA.brightness === 40,
      signals: [[service.events, 'vcp-set']],
      description: 'a shared-EDID display to be selected by display number',
    });
    if (twinB.brightness !== 20) throw new Error('Adjusting one twin changed the other');

    await waitForTiming(250, 'delay: finish prior writes before holding a hardware reply');
    service.holdWrite = true;
    const heldWritesBefore = service.writes.length;
    matchedSlider.slider.value = 0.25;
    await waitForCondition({
      evaluate: () => service.pendingWrite !== null,
      signals: [[service.events, 'vcp-set']],
      description: 'the first hardware write reply to remain in flight',
    });
    matchedSlider.slider.value = 0.35;
    matched.max = 60;
    Main.layoutManager.emit('monitors-changed');
    await waitForSliderCount(5, 'discovery with a held write to finish');
    const newMaximum = await calibrationTarget(monitor.get_display_name());
    if (newMaximum.reportedMax !== 60 || newMaximum.mode !== 'reported')
      throw new Error('A busy queue hid the newly reported maximum');
    if (!matchedSlider.slider.reactive)
      throw new Error('An uncalibrated display did not adopt its newly reported maximum');
    matched.max = 0;
    Main.layoutManager.emit('monitors-changed');
    await waitForSliderCount(5, 'a zero reported maximum to be processed');
    const zeroMaximum = await calibrationTarget(monitor.get_display_name());
    if (zeroMaximum.reportedMax !== 0)
      throw new Error('A zero maximum was discarded while a write was in flight');
    await saveCalibration(settings, zeroMaximum, 'paused');
    service.releaseWrite();
    await waitForTiming(
      300,
      'negative check: topology invalidation must discard a genuinely queued write',
    );
    if (service.writes.length !== heldWritesBefore + 1)
      throw new Error('A queued hardware value survived calibration invalidation');
    matched.max = 100;

    const twinCalibration = await calibrationTarget('TWIN (1)');
    await saveCalibration(settings, twinCalibration, 'manual', 5, 35);
    service.holdListing = true;
    Main.layoutManager.emit('monitors-changed');
    await waitForCondition({
      evaluate: () => service.pendingListing !== null,
      signals: [[service.events, 'detection-called']],
      description: 'the new enumeration to remain in flight',
    });
    const twinWrites = service.writes.length;
    twins[0].slider.value = 0.9;
    [twinA.number, twinB.number] = [twinB.number, twinA.number];
    service.releaseListing();
    await waitForSliderCount(5, 'enumeration of the renumbered twins to finish');
    if (service.writes.length !== twinWrites)
      throw new Error('A request made during enumeration reached a renumbered identical display');
    const twinTargets = (await calibrationTargets()).filter(({ name }) => name.startsWith('TWIN'));
    if (
      twinTargets.length !== 2 ||
      twinTargets.some(({ mode, min, max }) => mode !== 'manual' || min !== 5 || max !== 35)
    )
      throw new Error(
        `Identical displays do not share their model's profile: ${JSON.stringify(twinTargets)}`,
      );

    nativeScales = [];
    manager.emit('changed');
    if (allBrightnessSliders().length !== 5 || nativeSlider.visible)
      throw new Error('Removing the internal display left a stale brightness control');
    const reconnectedNativeScale = new NativeScale({ value: 0.8 });
    nativeScales = [reconnectedNativeScale];
    manager.emit('changed');
    if (allBrightnessSliders().length !== 6 || nativeSlider.visible)
      throw new Error('Reconnecting the internal display duplicated the brightness control');

    service.unown();
    await waitForSliderCount(0, 'sliders to disappear when the service leaves the bus');
    if (nativeSlider.visible !== nativeVisibleBefore)
      throw new Error('Losing the service did not restore native brightness');
    nativeSlider.slider.value = 0.55;
    if (Math.abs(reconnectedNativeScale.value - 0.55) > 0.001)
      throw new Error('The restored native master is not bound to the reconnected display');
    const nativeSection = nativeSlider._monitorBrightnessSection;
    const nativeRow = nativeSection._getMenuItems()[1];
    const nativeIndividual = nativeRow
      .get_children()
      .find((child) => child.has_style_class_name('slider-bin'))
      .get_child();
    nativeIndividual.value = 0.65;
    if (Math.abs(reconnectedNativeScale.value - 0.65) > 0.001)
      throw new Error('The restored native submenu is not bound to the reconnected display');
    const serviceCallsAfterVanish = serviceCalls.length;
    await waitForTiming(
      1000,
      'negative check: no service call may follow the vanish within the refresh delay',
    );
    if (serviceCalls.length !== serviceCallsAfterVanish)
      throw new Error(
        `The module called the service after it left the bus: ${JSON.stringify(serviceCalls.slice(serviceCallsAfterVanish))}`,
      );
    Scripting.scriptEvent('vanishDoesNotRespawn');

    service.listDetectedMissing = true;
    const detectCallsBeforeReturn = service.calls.Detect;
    await service.own();
    await waitForSliderCount(5, 'sliders to return when the service comes back');
    if (service.calls.Detect === detectCallsBeforeReturn)
      throw new Error('A service without ListDetected did not fall back to Detect');
    service.listDetectedMissing = false;
    const writesBeforePreferences = service.writes.length;
    const fixture = Gio.File.new_for_uri(import.meta.url)
      .get_parent()
      .get_child('fixtures')
      .get_child('brightnessPreferences.js')
      .get_path();
    const extensionPath = Main.extensionManager.lookup(EXTENSION_UUID).path;
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    // The preferences save profiles to the extension's own schema, as the Shell reads them.
    launcher.setenv(
      'GSETTINGS_SCHEMA_DIR',
      [`${extensionPath}/schemas`, GLib.getenv('GSETTINGS_SCHEMA_DIR')].filter(Boolean).join(':'),
      true,
    );
    const preferences = launcher.spawnv([
      'gjs',
      '-m',
      fixture,
      Gio.File.new_for_path(`${extensionPath}/preferences/brightnessCalibration.js`).get_uri(),
    ]);
    const [stdout, stderr] = await new Promise((resolve, reject) => {
      preferences.communicate_utf8_async(null, null, (_source, result) => {
        try {
          const [, out, err] = preferences.communicate_utf8_finish(result);
          resolve([out, err]);
        } catch (error) {
          reject(error);
        }
      });
    });
    if (!preferences.get_successful() || !stdout.includes('GTK_CALIBRATION_PASS'))
      throw new Error(
        `GTK preferences integration failed (${preferences.get_if_exited() ? `exit ${preferences.get_exit_status()}` : `signal ${preferences.get_term_sig()}`}): ${stdout}\n${stderr}`,
      );
    if (service.writes.length !== writesBeforePreferences)
      throw new Error('Saving calibration in GTK preferences wrote brightness');
    const configuredFromPreferences = await calibrationTarget('TEST-27');
    if (
      configuredFromPreferences.mode !== 'manual' ||
      configuredFromPreferences.min !== 5 ||
      configuredFromPreferences.max !== 35
    )
      throw new Error('The preferences profile did not reach the correct session target');
    settings.set_boolean('module-external-brightness', false);
    await waitForModuleState(settings, 'module-external-brightness', 'external-brightness', false);
    if (brightnessSliders().length !== 0)
      throw new Error('Disabling the module left brightness sliders behind');
    if (nativeSlider.visible !== nativeVisibleBefore)
      throw new Error('Disabling the module did not restore native brightness');
    if (overlay.get_n_children() !== overlayChildrenBefore)
      throw new Error('Disabling the module left slider menus in the Quick Settings overlay');
    Scripting.scriptEvent('disableReleasesUi');

    const startingCalls = serviceCalls.filter(
      ({ flags }) => !(flags & Gio.DBusCallFlags.NO_AUTO_START),
    );
    if (
      startingCalls.length !== 1 ||
      serviceCalls[0] !== startingCalls[0] ||
      !startingCalls[0].method.endsWith('Detected')
    )
      throw new Error(
        `Expected only the first listing to allow service activation: ${JSON.stringify(startingCalls)}`,
      );
    Scripting.scriptEvent('startsServiceOnce');

    // Re-enabling stands in for a reboot: nothing but GSettings carries the profile over.
    if (
      !settings
        .get_strv('external-brightness-calibrations')
        .some((entry) => entry.startsWith(modelId(unmatched)))
    )
      throw new Error('The calibration was not stored');
    if (
      settings.get_strv('external-brightness-calibrations').some((entry) => entry.includes('EDID'))
    )
      throw new Error('The stored calibration contains a raw EDID');
    settings.set_boolean('module-external-brightness', true);
    await waitForModuleState(settings, 'module-external-brightness', 'external-brightness', true);
    await waitForSliderCount(5, 'displays to return after the module restarts');
    const persisted = await calibrationTarget('TEST-27');
    if (persisted.mode !== 'manual' || persisted.min !== 5 || persisted.max !== 35)
      throw new Error(`The calibration did not survive a restart: ${JSON.stringify(persisted)}`);
    const pausedMatched = await calibrationTarget(monitor.get_display_name());
    if (pausedMatched.mode !== 'paused') throw new Error('A paused display did not stay paused');
    await saveCalibration(settings, pausedMatched, 'reported');
    const resetMatched = await calibrationTarget(monitor.get_display_name());
    if (resetMatched.mode !== 'reported')
      throw new Error('Using the reported range did not clear the stored pause');
    if (
      settings
        .get_strv('external-brightness-calibrations')
        .some((entry) => entry.startsWith(modelId(matched)))
    )
      throw new Error('Using the reported range left the profile stored');
    settings.set_boolean('module-external-brightness', false);
    await waitForModuleState(settings, 'module-external-brightness', 'external-brightness', false);
    Scripting.scriptEvent('calibrationPersists');
  } finally {
    settings.reset('external-brightness-calibrations');
    Gio.DBus.session.signal_unsubscribe(calibrationSubscription);
    delete manager.scales;
    delete manager.globalScale;
    manager.emit('changed');
    Gio.DBusConnection.prototype.call = originalCall;
    monitorManager.get_monitors = originalGetMonitors;
    Main.osdWindowManager.show = originalShowOsd;
    settings.set_boolean('module-external-brightness', originalEnabled);
    service.destroy();
    await Scripting.waitLeisure();
  }
}

let _slidersMatchDisplays = false;
let _writesCoalesced = false;
let _osdTargetsMatchedMonitor = false;
let _externalChangeShown = false;
let _hotplugRedetects = false;
let _vanishDoesNotRespawn = false;
let _disableReleasesUi = false;
let _startsServiceOnce = false;
let _calibrationPersists = false;

export function script_slidersMatchDisplays() {
  _slidersMatchDisplays = true;
}

export function script_writesCoalesced() {
  _writesCoalesced = true;
}

export function script_osdTargetsMatchedMonitor() {
  _osdTargetsMatchedMonitor = true;
}

export function script_externalChangeShown() {
  _externalChangeShown = true;
}

export function script_hotplugRedetects() {
  _hotplugRedetects = true;
}

export function script_vanishDoesNotRespawn() {
  _vanishDoesNotRespawn = true;
}

export function script_disableReleasesUi() {
  _disableReleasesUi = true;
}

export function script_startsServiceOnce() {
  _startsServiceOnce = true;
}

export function script_calibrationPersists() {
  _calibrationPersists = true;
}

export function finish() {
  if (!_slidersMatchDisplays) throw new Error('Sliders were not verified against the displays');
  if (!_writesCoalesced)
    throw new Error('Brightness write coalescing and spacing were not verified');
  if (!_osdTargetsMatchedMonitor) throw new Error('OSD targeting was not verified');
  if (!_externalChangeShown) throw new Error('External brightness changes were not verified');
  if (!_hotplugRedetects) throw new Error('Hotplug redetection was not verified');
  if (!_vanishDoesNotRespawn) throw new Error('Service disappearance was not verified');
  if (!_disableReleasesUi) throw new Error('Module disable cleanup was not verified');
  if (!_startsServiceOnce) throw new Error('Service activation policy was not verified');
  if (!_calibrationPersists) throw new Error('Calibration persistence was not verified');
}
