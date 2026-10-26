import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import {
  BRIGHTNESS_CALIBRATION_PATH,
  BRIGHTNESS_CALIBRATION_TARGETS_TYPE,
  BRIGHTNESS_CALIBRATION_XML,
  type BrightnessCalibrationTarget,
  type BrightnessCalibrationTargetTuple,
} from '~/shared/brightnessCalibrationProtocol.ts';

function targetTuple(target: BrightnessCalibrationTarget): BrightnessCalibrationTargetTuple {
  return [
    target.displayId,
    target.name,
    target.mode,
    target.reportedMax,
    target.min,
    target.max,
    target.available,
  ];
}

/** Lists the external displays for the calibration preferences on the session bus. */
export class BrightnessCalibrationService {
  private _exported: Gio.DBusExportedObject | null;

  constructor(listTargets: () => BrightnessCalibrationTarget[]) {
    this._exported = Gio.DBusExportedObject.wrapJSObject(BRIGHTNESS_CALIBRATION_XML, {
      GetTargetsAsync: (_parameters: [], invocation: Gio.DBusMethodInvocation) => {
        const targets = listTargets().map(targetTuple);
        invocation.return_value(new GLib.Variant(BRIGHTNESS_CALIBRATION_TARGETS_TYPE, [targets]));
      },
    });
    this._exported.export(Gio.DBus.session, BRIGHTNESS_CALIBRATION_PATH);
  }

  notifyChanged(): void {
    if (!this._exported) return;

    this._exported.emit_signal('Changed', new GLib.Variant('()', []));
  }

  destroy(): void {
    if (!this._exported) return;

    this._exported.unexport();
    this._exported = null;
  }
}
