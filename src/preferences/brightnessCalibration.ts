import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';
import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { parseBrightnessRange } from '~/panel/externalBrightness/brightnessCalibration.ts';
import {
  CALIBRATIONS_KEY,
  storeCalibrationProfile,
  type CalibrationProfile,
} from '~/panel/externalBrightness/calibrationProfiles.ts';
import {
  BRIGHTNESS_CALIBRATION_BUS,
  BRIGHTNESS_CALIBRATION_INTERFACE,
  BRIGHTNESS_CALIBRATION_PATH,
  BRIGHTNESS_CALIBRATION_TARGETS_TYPE,
  type BrightnessCalibrationTarget,
  type BrightnessCalibrationTargetTuple,
} from '~/shared/brightnessCalibrationProtocol.ts';
import { gettext as _ } from '~/shared/i18n.ts';

// The preferences process does not get GNOME Shell's promisified DBusConnection.call.
// @ts-ignore — _promisify is a GJS extension not reflected in .d.ts
Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

function parseTarget([
  displayId,
  name,
  mode,
  reportedMax,
  min,
  max,
  available,
]: BrightnessCalibrationTargetTuple): BrightnessCalibrationTarget {
  return {
    displayId,
    name,
    mode: mode === 'manual' || mode === 'paused' ? mode : 'reported',
    reportedMax,
    min,
    max,
    available,
  };
}

/**
 * The Shell lists the displays over D-Bus; profiles are saved straight to GSettings, which the
 * Shell watches and applies without writing brightness.
 */
export function buildBrightnessCalibrationRow(
  title: string,
  subtitle: string,
  settings: Gio.Settings,
): Adw.ActionRow {
  const row = new Adw.ActionRow({
    title,
    subtitle,
    use_markup: false,
  });
  const button = new Gtk.Button({ label: _('Configure…'), valign: Gtk.Align.CENTER });
  button.connect('clicked', () => new BrightnessCalibrationPreferences(row, settings));
  row.add_suffix(button);
  row.activatable_widget = button;
  return row;
}

function profileStatus(mode: BrightnessCalibrationTarget['mode']): string {
  switch (mode) {
    case 'paused':
      return _('Control paused');
    case 'manual':
      return _('Manual limits active');
    case 'reported':
      return _('Using reported range');
  }
}

type SaveProfile = (target: BrightnessCalibrationTarget, profile: CalibrationProfile) => void;

/**
 * The calibration controls of one display. A refresh updates them in place, so limits being typed
 * keep their text and focus when the Shell reports a change.
 */
class CalibrationTargetGroup {
  readonly group = new Adw.PreferencesGroup();
  private _status = new Adw.ActionRow({ use_markup: false });
  private _reset = new Gtk.Button({ label: _('Use reported range'), valign: Gtk.Align.CENTER });
  private _minimum = new Adw.EntryRow({ title: _('Minimum raw value'), use_markup: false });
  private _maximum = new Adw.EntryRow({ title: _('Maximum raw value'), use_markup: false });
  private _actions = new Adw.ActionRow({
    title: _('Apply without changing brightness'),
    use_markup: false,
  });
  private _pause = new Gtk.Button({ label: _('Pause control') });
  private _apply = new Gtk.Button({ label: _('Apply limits') });
  // The limits last filled in from the Shell; an entry still showing them was not edited.
  private _shownMinimum = '';
  private _shownMaximum = '';

  constructor(
    public target: BrightnessCalibrationTarget,
    saveProfile: SaveProfile,
  ) {
    this._status.add_suffix(this._reset);
    this.group.add(this._status);
    this.group.add(this._minimum);
    this.group.add(this._maximum);

    const buttons = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
    this._apply.add_css_class('suggested-action');
    buttons.append(this._pause);
    buttons.append(this._apply);
    this._actions.add_suffix(buttons);
    this.group.add(this._actions);

    this._minimum.connect('notify::text', () => this._syncApply());
    this._maximum.connect('notify::text', () => this._syncApply());
    this._reset.connect('clicked', () => saveProfile(this.target, { mode: 'reported' }));
    this._pause.connect('clicked', () => saveProfile(this.target, { mode: 'paused' }));
    this._apply.connect('clicked', () => {
      const range = parseBrightnessRange(this._minimum.text, this._maximum.text);
      if (!range) return;

      saveProfile(this.target, { mode: 'manual', ...range });
    });

    this.update(target);
  }

  update(target: BrightnessCalibrationTarget): void {
    this.target = target;
    this.group.title = target.name;
    this.group.description = _('Reported maximum: %s').replace('%s', String(target.reportedMax));

    this._status.title = profileStatus(target.mode);
    this._status.subtitle = target.available
      ? _('Saved for this monitor model')
      : _('Display detection is pending or brightness is unavailable');
    this._reset.sensitive = target.available && target.mode !== 'reported';
    this._pause.sensitive = target.available;

    const minimum = target.mode === 'manual' ? String(target.min) : '';
    const maximum = target.mode === 'manual' ? String(target.max) : '';
    if (this._minimum.text === this._shownMinimum) this._minimum.text = minimum;
    if (this._maximum.text === this._shownMaximum) this._maximum.text = maximum;
    this._shownMinimum = minimum;
    this._shownMaximum = maximum;

    this._syncApply();
  }

  private _syncApply(): void {
    const range = parseBrightnessRange(this._minimum.text, this._maximum.text);
    this._apply.sensitive = this.target.available && this.target.reportedMax > 0 && range !== null;
    this._actions.subtitle = range ? '' : _('Use whole numbers: 0 ≤ minimum < maximum ≤ 65535.');
  }
}

class BrightnessCalibrationPreferences {
  private _lifecycle = new LifecycleScope();
  private _cancellable: Gio.Cancellable | null = new Gio.Cancellable();
  private _readRequest: object | null = null;
  private _groups: CalibrationTargetGroup[] = [];
  private _page = new Adw.PreferencesPage({ title: _('Monitor calibration') });
  private _status = new Adw.ActionRow({ title: _('Loading displays…'), use_markup: false });
  constructor(
    parent: Gtk.Widget,
    private readonly _settings: Gio.Settings,
  ) {
    const dialog = new Adw.PreferencesDialog({
      title: _('Monitor calibration'),
      content_width: 600,
      content_height: 640,
    });
    const summary = new Adw.PreferencesGroup({
      description: _(
        'Raw DDC limits, not percentages. Saving does not change brightness. Each profile is saved for the monitor model and applies to every monitor of that model.',
      ),
    });
    const refresh = new Gtk.Button({
      icon_name: 'view-refresh-symbolic',
      tooltip_text: _('Refresh displays'),
      valign: Gtk.Align.CENTER,
    });
    refresh.connect('clicked', () => {
      void this._refresh();
    });
    this._status.add_suffix(refresh);
    summary.add(this._status);
    this._page.add(summary);
    dialog.add(this._page);

    const subscription = Gio.DBus.session.signal_subscribe(
      BRIGHTNESS_CALIBRATION_BUS,
      BRIGHTNESS_CALIBRATION_INTERFACE,
      'Changed',
      BRIGHTNESS_CALIBRATION_PATH,
      null,
      Gio.DBusSignalFlags.NONE,
      () => {
        void this._refresh();
      },
    );
    this._lifecycle.onDispose(() => Gio.DBus.session.signal_unsubscribe(subscription));
    this._lifecycle.connect(dialog, 'closed', () => {
      this._readRequest = null;
      this._cancellable?.cancel();
      this._cancellable = null;
      this._lifecycle.dispose();
    });
    dialog.present(parent);
    void this._refresh();
  }

  private async _refresh(): Promise<void> {
    if (!this._cancellable) return;
    const request = {};
    this._readRequest = request;
    try {
      const reply = await Gio.DBus.session.call(
        BRIGHTNESS_CALIBRATION_BUS,
        BRIGHTNESS_CALIBRATION_PATH,
        BRIGHTNESS_CALIBRATION_INTERFACE,
        'GetTargets',
        null,
        new GLib.VariantType(BRIGHTNESS_CALIBRATION_TARGETS_TYPE),
        Gio.DBusCallFlags.NO_AUTO_START,
        5000,
        this._cancellable,
      );
      if (this._readRequest !== request) return;
      const [tuples] = reply.deepUnpack() as [BrightnessCalibrationTargetTuple[]];
      const targets = tuples.map(parseTarget);
      this._status.title = targets.length
        ? _('External displays')
        : _('No external displays available');
      this._status.subtitle = _(
        'Enable External Display Brightness and wait for detection. Refresh if needed.',
      );
      this._showTargets(targets);
    } catch {
      if (this._readRequest !== request) return;
      this._clearTargets();
      this._status.title = _('Calibration unavailable');
      this._status.subtitle = _(
        'Enable External Display Brightness, then refresh. Existing limits are not changed.',
      );
    }
  }

  private _showTargets(targets: BrightnessCalibrationTarget[]): void {
    const sameDisplays =
      targets.length === this._groups.length &&
      targets.every((target, index) => target.displayId === this._groups[index]!.target.displayId);
    if (sameDisplays) {
      for (const [index, target] of targets.entries()) this._groups[index]!.update(target);
      return;
    }

    this._clearTargets();
    for (const target of targets) {
      const targetGroup = new CalibrationTargetGroup(target, (current, profile) =>
        this._saveProfile(current, profile),
      );
      this._groups.push(targetGroup);
      this._page.add(targetGroup.group);
    }
  }

  private _clearTargets(): void {
    for (const { group } of this._groups) this._page.remove(group);
    this._groups = [];
  }

  private _saveProfile(target: BrightnessCalibrationTarget, profile: CalibrationProfile): void {
    const stored = this._settings.get_strv(CALIBRATIONS_KEY);
    this._settings.set_strv(
      CALIBRATIONS_KEY,
      storeCalibrationProfile(stored, target.displayId, profile, target.reportedMax),
    );
  }
}
