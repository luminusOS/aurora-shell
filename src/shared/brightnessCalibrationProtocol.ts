export const BRIGHTNESS_CALIBRATION_BUS = 'org.gnome.Shell';
export const BRIGHTNESS_CALIBRATION_PATH = '/org/gnome/Shell/Extensions/AuroraShell/Brightness';
export const BRIGHTNESS_CALIBRATION_INTERFACE = 'org.gnome.Shell.Extensions.AuroraShell.Brightness';
export const BRIGHTNESS_CALIBRATION_TARGETS_TYPE = '(a(sssuuub))';
export const BRIGHTNESS_CALIBRATION_XML = `<node>
  <interface name="${BRIGHTNESS_CALIBRATION_INTERFACE}">
    <method name="GetTargets"><arg type="a(sssuuub)" direction="out"/></method>
    <signal name="Changed"/>
  </interface>
</node>`;

/**
 * One external display as the preferences see it. The Shell only reports displays; the
 * preferences store a profile for `displayId` in GSettings, and the Shell applies it from there.
 */
export type BrightnessCalibrationTarget = {
  displayId: string;
  name: string;
  mode: 'reported' | 'manual' | 'paused';
  reportedMax: number;
  min: number;
  max: number;
  /** False while displays are being enumerated, when the Shell does not apply profiles yet. */
  available: boolean;
};

/** A target on the bus, in the field order of `a(sssuuub)`. */
export type BrightnessCalibrationTargetTuple = [
  string,
  string,
  string,
  number,
  number,
  number,
  boolean,
];
