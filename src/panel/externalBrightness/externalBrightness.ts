import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import * as Main from '@girs/gnome-shell/ui/main';
import { QuickSlider } from '@girs/gnome-shell/ui/quickSettings';
import { PopupBaseMenuItem } from '@girs/gnome-shell/ui/popupMenu';

import { LifecycleScope } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedTimeout, type ManagedTimeout } from '~/core/mainLoop.ts';
import { Module } from '~/module.ts';

import { DisplayBrightnessSlider } from './brightnessSliders.ts';
import { BrightnessCalibrationService } from './calibrationService.ts';
import type { BrightnessRange } from './brightnessCalibration.ts';
import {
  CALIBRATIONS_KEY,
  findCalibrationProfile,
  PAUSED_PROFILE,
  sameCalibrationProfile,
  type CalibrationProfile,
} from './calibrationProfiles.ts';
import type { BrightnessCalibrationTarget } from '~/shared/brightnessCalibrationProtocol.ts';
import { combinedBrightness, shiftBrightness } from './brightnessLevels.ts';
import { NativeBrightnessControls, type MonitorLevel } from './nativeBrightness.ts';
import { BrightnessWriteQueue, sliderToVcpValue, vcpToSliderValue } from './brightnessWrites.ts';
import {
  describeExternalDisplays,
  displayModel,
  selectorMatches,
  type DdcDisplay,
  type ExternalDisplay,
  type MonitorIdentity,
} from './ddcDisplays.ts';
import {
  DdcutilServiceClient,
  isCancelledError,
  isServiceMissingError,
  type BrightnessReading,
  type DetectionRequest,
} from './ddcutilService.ts';

const LOG_PREFIX = 'ExternalBrightness';
// Coalesces the bursts of service, connection and monitor notifications that one event produces.
const REFRESH_DELAY_MS = 500;
// DDC/CI on a newly connected monitor is often not ready as soon as Mutter reports it.
const HOTPLUG_REFRESH_DELAY_MS = 1500;
// Minimum pause between writes to one display, to keep slider drags close to the write rate of a
// monitor's own buttons.
const WRITE_SPACING_MS = 150;
const QUICK_SETTINGS_COLUMNS = 2;

type DisplayControl = {
  external: ExternalDisplay;
  max: number;
  current: number;
  profile: CalibrationProfile;
  slider: DisplayBrightnessSlider;
  menuItem: PopupBaseMenuItem;
  queue: BrightnessWriteQueue;
  writeSpacing: ManagedTimeout;
  lifecycle: LifecycleScope;
  /** Counts user requests, so a brightness read that overlapped one is recognised as stale. */
  requestCount: number;
};

/** Identifies a monitor model for its stored calibration, without storing the model's name. */
function displayId(external: ExternalDisplay): string {
  const model = displayModel(external.display);
  return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, model, -1)!;
}

export class ExternalBrightness extends Module {
  private _lifecycle: LifecycleScope | null = null;
  private _service: DdcutilServiceClient | null = null;
  private _refreshTimer: ManagedTimeout | null = null;
  private _pendingRefresh: DetectionRequest | null = null;
  private _pendingRefreshDelay = 0;
  private _controls = new Map<string, DisplayControl>();
  private _master: DisplayBrightnessSlider | null = null;
  private _masterLevel = 0;
  private _nativeControls: NativeBrightnessControls | null = null;
  private _adjustingMaster = false;
  private _connectedMonitors = '';
  private _reportedServiceMissing = false;
  private _calibrationService: BrightnessCalibrationService | null = null;
  private _discoveryGeneration = 0;
  private _discoveryPending = true;

  override enable(): void {
    this.disable();

    const lifecycle = new LifecycleScope();
    this._lifecycle = lifecycle;
    this._refreshTimer = createManagedTimeout(lifecycle);
    this._calibrationService = new BrightnessCalibrationService(() =>
      this._getCalibrationTargets(),
    );
    lifecycle.connect(this.context.settings, `changed::${CALIBRATIONS_KEY}`, () =>
      this._applyStoredCalibrations(),
    );

    this._service = new DdcutilServiceClient({
      onDisplaysChanged: () => {
        this._queueRefresh({ redetect: false, startService: false }, REFRESH_DELAY_MS);
      },
      onServiceVanished: () => {
        // A refresh still reading would otherwise finish against a restarted service instance.
        this._invalidateDiscovery();
        this._removeAllControls();
      },
      onBrightnessChanged: (displayNumber, edid, value) =>
        this._showExternalBrightness(displayNumber, edid, value),
    });
    this._service.start();

    this._connectedMonitors = this._describeConnectedMonitors();
    lifecycle.connect(Main.layoutManager, 'monitors-changed', () => this._handleMonitorsChanged());
    // The only request allowed to start the service: one D-Bus activation per enable.
    this._queueRefresh({ redetect: false, startService: true }, REFRESH_DELAY_MS);
  }

  override disable(): void {
    this._invalidateDiscovery();
    this._removeAllControls();
    this._calibrationService?.destroy();
    this._calibrationService = null;

    this._service?.stop();
    this._service = null;

    this._lifecycle?.dispose();
    this._nativeControls?.destroy();
    this._nativeControls = null;
    this._master?.destroy();
    this._master = null;
    this._masterLevel = 0;
    this._lifecycle = null;
    this._refreshTimer = null;
    this._pendingRefresh = null;
    this._pendingRefreshDelay = 0;
    this._connectedMonitors = '';
    this._reportedServiceMissing = false;
  }

  private _handleMonitorsChanged(): void {
    // monitors-changed also fires for scale, mode, arrangement and HDR changes. A DDC detection
    // blocks the service's main loop, so it only runs when a monitor was connected, removed or
    // swapped on a connector; other changes only re-list, which still updates names and
    // backlight-controlled monitors.
    const connectedMonitors = this._describeConnectedMonitors();
    const redetect = connectedMonitors !== this._connectedMonitors;
    this._connectedMonitors = connectedMonitors;

    this._queueRefresh(
      { redetect, startService: false },
      redetect ? HOTPLUG_REFRESH_DELAY_MS : REFRESH_DELAY_MS,
    );
  }

  private _describeConnectedMonitors(): string {
    return this._monitorIdentities()
      .map(({ connector, vendor, product, serial }) =>
        [connector, vendor, product, serial].join('\t'),
      )
      .sort()
      .join('\n');
  }

  private _queueRefresh(request: DetectionRequest, delayMs: number): void {
    if (!this._refreshTimer) return;
    this._invalidateDiscovery();

    const pending = this._pendingRefresh;
    const merged: DetectionRequest = {
      redetect: request.redetect || (pending !== null && pending.redetect),
      startService: request.startService || (pending !== null && pending.startService),
    };
    this._pendingRefresh = merged;
    this._pendingRefreshDelay = Math.max(delayMs, this._pendingRefreshDelay);

    // Each call replaces the timer, so the last scheduled callback carries the fully merged request.
    this._refreshTimer.schedule(this._pendingRefreshDelay, () => {
      this._pendingRefresh = null;
      this._pendingRefreshDelay = 0;
      void this._refreshDisplays(merged);
    });
  }

  private async _refreshDisplays(request: DetectionRequest): Promise<void> {
    if (!this._service) return;

    const activeService = this._service;
    const discoveryGeneration = this._discoveryGeneration;

    let displays: DdcDisplay[];
    try {
      displays = await activeService.detectDisplays(request);
    } catch (e) {
      if (discoveryGeneration !== this._discoveryGeneration || isCancelledError(e)) return;

      this._reportDetectionFailure(e);
      return;
    }
    if (discoveryGeneration !== this._discoveryGeneration) return;

    this._reportedServiceMissing = false;
    const externalDisplays = describeExternalDisplays(displays, this._monitorIdentities());
    this._removeControlsExcept(new Set(externalDisplays.map(({ key }) => key)));

    // Reads run one at a time: the service handles calls in order, and a display that fails DDC
    // retries for seconds, which would push parallel reads past their timeout.
    for (const external of externalDisplays) {
      const control = this._controls.get(external.key);
      const requestCountBeforeRead = control ? control.requestCount : 0;
      const reading = await this._readBrightness(activeService, external);
      if (discoveryGeneration !== this._discoveryGeneration) return;
      if (!reading) continue;

      const currentControl = this._controls.get(external.key);
      if (!currentControl) {
        if (reading.max > 0) this._addControl(external, reading);
        continue;
      }

      this._updateControl(currentControl, external);
      this._acceptReading(
        currentControl,
        reading,
        currentControl.requestCount === requestCountBeforeRead && !currentControl.queue.busy,
      );
    }
    this._discoveryPending = false;
    // Detection paused every calibrated display; the stored profiles follow the EDID, so a
    // renumbered or reconnected display gets the profile of its own model back.
    for (const control of this._controls.values())
      this._setCalibration(control, this._storedProfile(control));
    this._calibrationService?.notifyChanged();
  }

  private async _readBrightness(
    service: DdcutilServiceClient,
    external: ExternalDisplay,
  ): Promise<BrightnessReading | null> {
    try {
      return await service.getBrightness(external.selector);
    } catch (e) {
      if (!isCancelledError(e))
        logger.warn(`Display ${external.display.modelName} does not report brightness: ${e}`, {
          prefix: LOG_PREFIX,
        });
      return null;
    }
  }

  private _reportDetectionFailure(error: unknown): void {
    if (!isServiceMissingError(error)) {
      // Keep the current sliders: a timeout or ddcutil error does not mean the displays are gone.
      logger.warn(`Failed to detect DDC/CI displays: ${error}`, { prefix: LOG_PREFIX });
      return;
    }

    this._removeAllControls();
    if (this._reportedServiceMissing) return;

    this._reportedServiceMissing = true;
    logger.log('ddcutil-service is not available; external display brightness stays off', {
      prefix: LOG_PREFIX,
    });
  }

  private _monitorIdentities(): MonitorIdentity[] {
    const monitors = global.backend.get_monitor_manager().get_monitors();
    if (!monitors) return [];

    return monitors.map((monitor) => ({
      vendor: monitor.get_vendor() || '',
      product: monitor.get_product() || '',
      serial: monitor.get_serial() || '',
      displayName: monitor.get_display_name() || '',
      connector: monitor.get_connector() || '',
      // GNOME's brightness manager only controls the backlights of active monitors.
      hasBacklight: monitor.is_active() && monitor.get_backlight() !== null,
    }));
  }

  private _addControl(external: ExternalDisplay, reading: BrightnessReading): void {
    if (!this._master) this._addMaster();
    if (!this._master) return;

    const lifecycle = new LifecycleScope();
    const slider = new DisplayBrightnessSlider();
    slider.x_expand = true;
    const menuItem = new PopupBaseMenuItem({ reactive: false, can_focus: false });
    menuItem.add_child(slider);
    const control: DisplayControl = {
      external,
      max: reading.max,
      current: reading.current,
      profile: findCalibrationProfile(
        this.context.settings.getStrv(CALIBRATIONS_KEY),
        displayId(external),
        reading.max,
      ),
      slider,
      menuItem,
      queue: new BrightnessWriteQueue(reading.current),
      writeSpacing: createManagedTimeout(lifecycle),
      lifecycle,
      requestCount: 0,
    };

    slider.setDisplayName(external.name || _('External Display'));
    lifecycle.connect(slider, 'brightness-requested', (_slider, value: number) => {
      if (this._requestBrightness(control, value)) {
        this._showOsd(this._monitorLevels(control));
      }
      this._syncMaster();
    });
    lifecycle.connect(slider, 'brightness-shown', () => this._syncMaster());

    this._master.menu.addMenuItem(menuItem);
    this._controls.set(external.key, control);
    this._applyReading(control, reading.current);
  }

  private _addMaster(): void {
    if (!this._lifecycle) return;

    const quickSettings = Main.panel.statusArea.quickSettings;
    const nativeSlider = quickSettings?._brightness?.quickSettingsItems[0];
    if (!quickSettings || !(nativeSlider instanceof QuickSlider)) {
      logger.error('Could not find the Quick Settings brightness slider', { prefix: LOG_PREFIX });
      return;
    }

    const slider = new DisplayBrightnessSlider();
    slider.configureMaster();
    this._master = slider;
    this._lifecycle.connect(slider, 'brightness-requested', (_slider, value: number) => {
      // The slider only reports its new position, so the move is measured from the level the
      // master showed last.
      const from = this._masterLevel;
      this._masterLevel = value;

      const osdLevels: MonitorLevel[] = [];
      this._adjustingMaster = true;
      try {
        if (this._nativeControls) {
          this._nativeControls.applyMaster(from, value);
          osdLevels.push(...this._nativeControls.monitorLevels);
        }
        for (const control of this._controls.values()) {
          if (this._discoveryPending || !this._rangeFor(control)) continue;

          const target = shiftBrightness(control.slider.slider.value, from, value);
          control.slider.showBrightness(target);
          if (this._requestBrightness(control, target))
            osdLevels.push(...this._monitorLevels(control));
        }
      } finally {
        this._adjustingMaster = false;
      }
      // One OSD call for every display: each call hides the OSD on the monitors it leaves out.
      this._showOsd(osdLevels);
      this._syncMaster();
    });

    // The master takes the place of GNOME's brightness slider, which it hides while it is shown.
    quickSettings.menu.insertItemBefore(slider, nativeSlider, QUICK_SETTINGS_COLUMNS);
    this._nativeControls = new NativeBrightnessControls(slider, nativeSlider, () =>
      this._syncMaster(),
    );
  }

  private _syncMaster(): void {
    if (!this._master || this._adjustingMaster) return;

    this._master.visible = this._controls.size > 0;
    this._nativeControls?.setCombined(this._master.visible);
    if (this._controls.size === 0) {
      this._master.menu.close();
      return;
    }

    const activeControls = [...this._controls.values()].filter(
      (control) => this._rangeFor(control) !== null,
    );
    const levels = activeControls.map((control) => control.slider.slider.value);
    if (this._nativeControls) levels.push(...this._nativeControls.levels);
    this._masterLevel = combinedBrightness(levels);
    this._master.showBrightness(this._masterLevel);
  }

  private _updateControl(control: DisplayControl, external: ExternalDisplay): void {
    if (control.external.name !== external.name)
      control.slider.setDisplayName(external.name || _('External Display'));

    control.external = external;
  }

  private _removeControlsExcept(keepKeys: ReadonlySet<string>): void {
    for (const [key, control] of this._controls) {
      if (keepKeys.has(key)) continue;

      control.lifecycle.dispose();
      control.slider.destroy();
      control.menuItem.destroy();
      this._controls.delete(key);
    }
    this._syncMaster();
    this._calibrationService?.notifyChanged();
  }

  private _removeAllControls(): void {
    this._removeControlsExcept(new Set());
  }

  private _applyReading(control: DisplayControl, value: number): void {
    control.current = value;
    control.queue.noteKnownValue(value);
    this._showControlBrightness(control);
  }

  private _showControlBrightness(control: DisplayControl): void {
    const range = this._rangeFor(control);
    control.slider.slider.reactive = range !== null;
    control.slider.slider.can_focus = range !== null;
    if (range)
      control.slider.showBrightness(vcpToSliderValue(control.current, range.max, range.min));
    this._syncMaster();
  }

  private _showExternalBrightness(displayNumber: number, edid: string, value: number): void {
    for (const control of this._controls.values()) {
      if (selectorMatches(control.external.selector, displayNumber, edid))
        this._applyReading(control, value);
    }
  }

  /** Queues a write for the slider position; false when the display cannot take one now. */
  private _requestBrightness(control: DisplayControl, sliderValue: number): boolean {
    const range = this._rangeFor(control);
    if (this._discoveryPending || !range || !Number.isFinite(sliderValue)) return false;

    control.requestCount++;
    const value = control.queue.request(sliderToVcpValue(sliderValue, range.max, range.min));
    if (value !== null) void this._writeBrightness(control, value);
    return true;
  }

  /** The display's monitor and slider level for the OSD, if Mutter shows that display. */
  private _monitorLevels(control: DisplayControl): MonitorLevel[] {
    if (control.external.connector === null) return [];

    const monitorIndex = global.backend
      .get_monitor_manager()
      .get_monitor_for_connector(control.external.connector);
    if (monitorIndex < 0) return [];

    return [{ monitorIndex, level: control.slider.slider.value }];
  }

  private _showOsd(levels: readonly MonitorLevel[]): void {
    if (levels.length === 0) return;

    const osdLevels: Record<number, { level: number }> = {};
    for (const { monitorIndex, level } of levels) osdLevels[monitorIndex] = { level };

    Main.osdWindowManager.show(Gio.ThemedIcon.new('display-brightness-symbolic'), null, osdLevels);
  }

  private async _writeBrightness(control: DisplayControl, value: number): Promise<void> {
    if (!this._service) return;
    const range = this._rangeFor(control);
    if (this._discoveryPending || !range || value < range.min || value > range.max) {
      control.queue.discardPending();
      control.queue.finishWrite(false);
      return;
    }

    const activeService = this._service;
    const profileBeforeWrite = control.profile;
    let succeeded = true;
    try {
      await activeService.setBrightness(control.external.selector, value);
    } catch (e) {
      if (isCancelledError(e)) return;

      succeeded = false;
      logger.warn(`Failed to set brightness of ${control.external.display.modelName}: ${e}`, {
        prefix: LOG_PREFIX,
      });
    }
    if (this._controls.get(control.external.key) !== control) return;

    control.writeSpacing.schedule(WRITE_SPACING_MS, () => {
      const next = control.queue.finishWrite(succeeded);
      if (next !== null) {
        void this._writeBrightness(control, next);
        return;
      }

      if (!succeeded || control.profile !== profileBeforeWrite)
        void this._resyncBrightness(activeService, control);
    });
  }

  private async _resyncBrightness(
    service: DdcutilServiceClient,
    control: DisplayControl,
  ): Promise<void> {
    const requestCountBeforeRead = control.requestCount;
    const discoveryGeneration = this._discoveryGeneration;
    const reading = await this._readBrightness(service, control.external);
    if (
      !reading ||
      this._controls.get(control.external.key) !== control ||
      discoveryGeneration !== this._discoveryGeneration
    )
      return;

    this._acceptReading(
      control,
      reading,
      control.requestCount === requestCountBeforeRead && !control.queue.busy,
    );
  }

  private _acceptReading(
    control: DisplayControl,
    reading: BrightnessReading,
    acceptCurrent = true,
  ): void {
    if (control.max !== reading.max || reading.max <= 0) {
      control.max = reading.max;
      this._setCalibration(control, this._storedProfile(control));
      this._calibrationService?.notifyChanged();
    }
    if (acceptCurrent) this._applyReading(control, reading.current);
  }

  private _rangeFor(control: DisplayControl): BrightnessRange | null {
    if (control.max <= 0) return null;

    switch (control.profile.mode) {
      case 'reported':
        return { min: 0, max: control.max };
      case 'manual':
        return { min: control.profile.min, max: control.profile.max };
      case 'paused':
        return null;
    }
  }

  /** Lists every display with its stored profile, not the pause a detection in progress applies. */
  private _getCalibrationTargets(): BrightnessCalibrationTarget[] {
    return [...this._controls.values()].map((control) => {
      const profile = this._storedProfile(control);

      return {
        displayId: displayId(control.external),
        name: control.external.name || _('External Display'),
        mode: profile.mode,
        reportedMax: control.max,
        min: profile.mode === 'manual' ? profile.min : 0,
        max: profile.mode === 'manual' ? profile.max : control.max,
        available: !this._discoveryPending,
      };
    });
  }

  /**
   * Applies profiles saved by the preferences. Applying never writes brightness; it only reads the
   * display again, so the slider shows the current value inside the new range. Displays that share
   * an EDID are the same model, so they share one stored profile.
   */
  private _applyStoredCalibrations(): void {
    // Detection pauses every calibrated display, then applies the stored profiles when it ends.
    if (!this._discoveryPending) {
      for (const control of this._controls.values()) {
        const profile = this._storedProfile(control);
        if (sameCalibrationProfile(profile, control.profile)) continue;

        this._setCalibration(control, profile);
        if (this._service) void this._resyncBrightness(this._service, control);
      }
    }

    // The preferences refresh on this signal, after the Shell has seen their change.
    this._calibrationService?.notifyChanged();
  }

  private _storedProfile(control: DisplayControl): CalibrationProfile {
    return findCalibrationProfile(
      this.context.settings.getStrv(CALIBRATIONS_KEY),
      displayId(control.external),
      control.max,
    );
  }

  private _setCalibration(control: DisplayControl, profile: CalibrationProfile): void {
    control.requestCount++;
    control.queue.discardPending();
    control.profile = profile;
    this._showControlBrightness(control);
  }

  private _invalidateDiscovery(): void {
    this._discoveryGeneration++;
    this._discoveryPending = true;
    // Until detection confirms which display is which, a stored range could reach another model.
    for (const control of this._controls.values()) {
      if (control.profile.mode === 'reported') control.queue.discardPending();
      else this._setCalibration(control, PAUSED_PROFILE);
    }
    this._calibrationService?.notifyChanged();
  }
}
