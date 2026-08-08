import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';
import GWeather from 'gi://GWeather';
import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { LifecycleScope, type ManagedSource } from '~/core/lifecycleScope.ts';
import { logger } from '~/core/logger.ts';
import { createManagedSource } from '~/core/mainLoop.ts';
import { Module } from '~/module.ts';
import { registerClockPillWidget, type ClockPillRegistration } from '~/shared/clockPill.ts';

import {
  deriveWeatherPresentation,
  normalizeWeatherSnapshot,
  type WeatherSnapshot,
} from './weatherClockLogic.ts';

const LOG_PREFIX = 'WeatherClock';
const AFTER_CLOCK_KEY = 'weather-clock-after-clock';
const CLOCK_PILL_ID = 'weather-clock';
const GNOME_WEATHER_SOURCE_KEY = 'gnome-weather';
const GWEATHER_SCHEMA_ID = 'org.gnome.GWeather4';
const TEMPERATURE_UNIT_KEY = 'temperature-unit';
const REFRESH_INTERVAL_SECONDS = 600;
const MAX_RETRIES = 5;

type WeatherClient = {
  available: boolean;
  loading: boolean;
  info: {
    is_valid(): boolean;
    get_symbolic_icon_name(): string;
    get_value_temp(unit: GWeather.TemperatureUnit): [boolean, number];
    get_temp_summary(): string;
    get_value_sky(): [boolean, GWeather.Sky];
    get_sky(): string;
    get_value_conditions(): [boolean, GWeather.ConditionPhenomenon, unknown?];
    get_conditions(): string;
  };
  update(): void;
  connect(signal: string, callback: (...args: unknown[]) => void): number;
  disconnect(id: number): void;
};

type DateMenuWithWeather = {
  _weatherItem?: {
    _weatherClient?: WeatherClient;
  };
};

export class WeatherClock extends Module {
  private _clockPillRegistration: ClockPillRegistration | null = null;
  private _panelWidget: St.BoxLayout | null = null;
  private _icon: St.Icon | null = null;
  private _label: St.Label | null = null;
  private _weatherClient: WeatherClient | null = null;
  private _gweatherSettings: Gio.Settings | null = null;
  private _lifecycle: LifecycleScope | null = null;
  private _monitor: Gio.NetworkMonitor | null = null;
  private _snapshotsBySource = new Map<string, WeatherSnapshot>();
  private _snapshot: WeatherSnapshot | null = null;
  private _refreshTimer: ManagedSource | null = null;
  private _retryTimer: ManagedSource | null = null;
  private _retryCount = 0;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._lifecycle = new LifecycleScope();
    this._refreshTimer = createManagedSource(this._lifecycle);
    this._retryTimer = createManagedSource(this._lifecycle);
    this._monitor = Gio.NetworkMonitor.get_default();
    this._gweatherSettings = this._createGWeatherSettings();
    if (this._gweatherSettings)
      this._lifecycle.connect(this._gweatherSettings, `changed::${TEMPERATURE_UNIT_KEY}`, () =>
        this._onWeatherChanged(),
      );
    this._installClockWidget();
    this._connectWeatherBackend();
    this._startRefreshTimer();

    this._lifecycle.connect(this.context.settings, `changed::${AFTER_CLOCK_KEY}`, () =>
      this._registerClockWidget(),
    );
  }

  override disable(): void {
    this._lifecycle?.dispose();
    this._lifecycle = null;
    this._refreshTimer = null;
    this._retryTimer = null;

    if (this._clockPillRegistration) this._clockPillRegistration.unregister();
    this._clockPillRegistration = null;
    if (this._icon) this._icon.destroy();
    this._icon = null;
    if (this._label) this._label.destroy();
    this._label = null;
    if (this._panelWidget) this._panelWidget.destroy();
    this._panelWidget = null;
    this._weatherClient = null;
    this._gweatherSettings = null;
    this._monitor = null;
    this._snapshotsBySource.clear();
    this._snapshot = null;
    this._retryCount = 0;
  }

  setWeatherSnapshot(sourceKey: string, snapshot: Partial<WeatherSnapshot>): void {
    if (!this._lifecycle) return;

    this._snapshotsBySource.set(sourceKey, normalizeWeatherSnapshot(snapshot, this._now()));
    this._syncSnapshot();
  }

  clearWeatherSnapshot(sourceKey: string): void {
    this._snapshotsBySource.delete(sourceKey);
    this._syncSnapshot();
  }

  refreshWeather(): boolean {
    if (!this._weatherClient) return false;

    try {
      this._weatherClient.update();
      return true;
    } catch (e) {
      logger.warn(`Failed to refresh GNOME Weather: ${e}`, { prefix: LOG_PREFIX });
      return false;
    }
  }

  get currentSnapshot(): WeatherSnapshot | null {
    return this._snapshot;
  }

  get isVisible(): boolean {
    return Boolean(this._panelWidget?.visible);
  }

  private _installClockWidget(): void {
    this._panelWidget = new St.BoxLayout({
      style_class: 'aurora-weather-clock-widget',
      y_align: Clutter.ActorAlign.CENTER,
      y_expand: true,
      visible: false,
      reactive: false,
    });

    this._icon = new St.Icon({
      style_class: 'system-status-icon aurora-weather-clock-icon',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._panelWidget.add_child(this._icon);

    this._label = new St.Label({
      style_class: 'clock-label aurora-weather-clock-label',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._label.clutter_text.y_align = Clutter.ActorAlign.CENTER;
    this._panelWidget.add_child(this._label);

    this._registerClockWidget();
  }

  private _registerClockWidget(): void {
    if (!this._panelWidget) return;

    this._clockPillRegistration?.unregister();
    const afterClock = this.context.settings.getBoolean(AFTER_CLOCK_KEY);
    this._panelWidget.remove_style_class_name('weather-after-clock');
    if (afterClock) this._panelWidget.add_style_class_name('weather-after-clock');
    this._clockPillRegistration = registerClockPillWidget(
      CLOCK_PILL_ID,
      this._panelWidget,
      afterClock ? 'right' : 'left',
      afterClock ? 10 : 100,
    );
    this._render();
  }

  private _connectWeatherBackend(): void {
    if (!this._lifecycle) return;

    this._weatherClient = this._readWeatherClient();
    if (!this._weatherClient) {
      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, {
        available: false,
        hasConnectivity: this._hasConnectivity(),
      });
      return;
    }

    this._lifecycle.connect(this._weatherClient, 'changed', () => this._onWeatherChanged());
    this._lifecycle.connect(this._weatherClient, 'notify::available', () =>
      this._onWeatherChanged(),
    );
    if (this._monitor) {
      this._lifecycle.connect(this._monitor, 'notify::connectivity', () =>
        this._onConnectivityChanged(),
      );
    }

    this.refreshWeather();
  }

  private _readWeatherClient(): WeatherClient | null {
    const dateMenu = Main.panel.statusArea.dateMenu as unknown as DateMenuWithWeather;
    const weatherItem = dateMenu._weatherItem;
    if (!weatherItem || !weatherItem._weatherClient) return null;

    return weatherItem._weatherClient;
  }

  private _createGWeatherSettings(): Gio.Settings | null {
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup(GWEATHER_SCHEMA_ID, true);
    if (!schema) return null;

    return new Gio.Settings({ settings_schema: schema });
  }

  private _onConnectivityChanged(): void {
    if (!this._lifecycle) return;

    if (!this._hasConnectivity()) {
      const available = this._weatherClient ? this._weatherClient.available : true;

      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, {
        available,
        hasConnectivity: false,
      });
      return;
    }

    this._retryCount = 0;
    this.refreshWeather();
  }

  private _onWeatherChanged(): void {
    if (!this._lifecycle || !this._weatherClient || !this._retryTimer) return;

    if (!this._weatherClient.available) {
      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, {
        available: false,
        hasConnectivity: this._hasConnectivity(),
      });
      return;
    }

    if (this._weatherClient.loading) {
      return;
    }

    const snapshot = this._readSnapshotFromWeather(this._weatherClient);
    if (snapshot) {
      this._retryCount = 0;
      this._retryTimer.clear();
      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, snapshot);
      return;
    }

    if (!this._hasConnectivity()) {
      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, {
        available: true,
        hasConnectivity: false,
      });
    } else {
      this._scheduleRetry();
    }
  }

  private _readSnapshotFromWeather(weather: WeatherClient): Partial<WeatherSnapshot> | null {
    if (!weather.info?.is_valid()) return null;

    const iconName = weather.info.get_symbolic_icon_name();
    const [tempOk, tempValue] = weather.info.get_value_temp(this._getTemperatureUnit());
    const temperature = tempOk ? this._formatTemperature(tempValue) : '';
    if (!iconName || iconName === 'weather-missing-symbolic' || !temperature) return null;

    const [skyOk, skyValue] = weather.info.get_value_sky();
    const [condOk, condPhenom] = weather.info.get_value_conditions();
    let description = '';
    if (skyOk && skyValue !== GWeather.Sky.INVALID) {
      description = weather.info.get_sky();
    } else if (
      condOk &&
      condPhenom !== GWeather.ConditionPhenomenon.INVALID &&
      condPhenom !== GWeather.ConditionPhenomenon.NONE
    ) {
      description = weather.info.get_conditions();
    }

    return {
      iconName,
      temperature,
      description,
      available: true,
      hasConnectivity: this._hasConnectivity(),
    };
  }

  private _getTemperatureUnit(): GWeather.TemperatureUnit {
    switch (this._gweatherSettings?.get_string(TEMPERATURE_UNIT_KEY)) {
      case 'kelvin':
        return GWeather.TemperatureUnit.KELVIN;
      case 'centigrade':
        return GWeather.TemperatureUnit.CENTIGRADE;
      case 'fahrenheit':
        return GWeather.TemperatureUnit.FAHRENHEIT;
      default:
        return GWeather.TemperatureUnit.CENTIGRADE;
    }
  }

  private _formatTemperature(value: number): string {
    const rounded = Math.round(value);
    return `${rounded}°`;
  }

  private _scheduleRetry(): void {
    if (!this._retryTimer || this._retryTimer.active) return;

    this._retryCount++;
    if (this._retryCount > MAX_RETRIES) {
      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, {
        available: true,
        hasConnectivity: true,
      });
      return;
    }

    const delay = this._retryCount <= 2 ? 5 : 30;
    this._retryTimer.replace(() =>
      GLib.timeout_add_seconds(GLib.PRIORITY_LOW, delay, () => {
        this._retryTimer!.complete();
        this.refreshWeather();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  private _startRefreshTimer(): void {
    if (!this._refreshTimer) return;

    this._refreshTimer.replace(() =>
      GLib.timeout_add_seconds(GLib.PRIORITY_LOW, REFRESH_INTERVAL_SECONDS, () => {
        if (this._hasConnectivity()) this.refreshWeather();
        return GLib.SOURCE_CONTINUE;
      }),
    );
  }

  private _syncSnapshot(): void {
    this._snapshot = [...this._snapshotsBySource.values()].at(-1) ?? null;
    this._render();
  }

  private _render(): void {
    if (
      !this._lifecycle ||
      !this._clockPillRegistration ||
      !this._panelWidget ||
      !this._icon ||
      !this._label
    ) {
      return;
    }

    const presentation = deriveWeatherPresentation(this._snapshot, this._now());

    if (!presentation.visible) {
      this._panelWidget.visible = false;
      return;
    }

    this._panelWidget.visible = true;
    this._icon.icon_name = presentation.iconName;
    this._icon.show();
    this._label.text = presentation.label;
    this._label.show();
  }

  private _hasConnectivity(): boolean {
    if (!this._monitor) {
      return false;
    }

    return this._monitor.connectivity !== Gio.NetworkConnectivity.LOCAL;
  }

  private _now(): number {
    return Math.floor(Date.now() / 1000);
  }
}
