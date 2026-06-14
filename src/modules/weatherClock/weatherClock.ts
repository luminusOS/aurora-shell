import '@girs/gjs';
import { gettext as _ } from 'gettext';

import Clutter from '@girs/clutter-18';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import St from '@girs/st-18';
import GWeather from 'gi://GWeather';
import * as Main from '@girs/gnome-shell/ui/main';

import type { ExtensionContext } from '~/core/context.ts';
import { logger } from '~/core/logger.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/module.ts';
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

type SignalRecord = {
  obj: { disconnect(id: number): void };
  id: number;
};

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
  private _gweatherSettingsId = 0;
  private _monitor: Gio.NetworkMonitor | null = null;
  private _snapshotsBySource = new Map<string, WeatherSnapshot>();
  private _snapshot: WeatherSnapshot | null = null;
  private _settingsIds: number[] = [];
  private _signals: SignalRecord[] = [];
  private _refreshTimerId = 0;
  private _retryTimerId = 0;
  private _retryCount = 0;
  private _enabled = false;
  private _uiAlive = false;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this.disable();
    this._enabled = true;
    this._monitor = Gio.NetworkMonitor.get_default();
    this._gweatherSettings = this._createGWeatherSettings();
    this._gweatherSettingsId =
      this._gweatherSettings?.connect(`changed::${TEMPERATURE_UNIT_KEY}`, () =>
        this._onWeatherChanged(),
      ) ?? 0;
    this._installClockWidget();
    this._connectWeatherBackend();
    this._startRefreshTimer();

    this._settingsIds = [
      this.context.settings.connect(`changed::${AFTER_CLOCK_KEY}`, () =>
        this._registerClockWidget(),
      ),
    ];
  }

  override disable(): void {
    this._enabled = false;
    this._uiAlive = false;

    for (const id of this._settingsIds) this.context.settings.disconnect(id);
    this._settingsIds = [];

    for (const signal of this._signals) signal.obj.disconnect(signal.id);
    this._signals = [];

    if (this._gweatherSettingsId) this._gweatherSettings?.disconnect(this._gweatherSettingsId);
    this._gweatherSettingsId = 0;

    if (this._refreshTimerId) GLib.source_remove(this._refreshTimerId);
    this._refreshTimerId = 0;
    if (this._retryTimerId) GLib.source_remove(this._retryTimerId);
    this._retryTimerId = 0;

    this._clockPillRegistration?.unregister();
    this._clockPillRegistration = null;
    this._icon?.destroy();
    this._icon = null;
    this._label?.destroy();
    this._label = null;
    this._panelWidget?.destroy();
    this._panelWidget = null;
    this._weatherClient = null;
    this._gweatherSettings = null;
    this._monitor = null;
    this._snapshotsBySource.clear();
    this._snapshot = null;
    this._retryCount = 0;
  }

  setWeatherSnapshot(sourceKey: string, snapshot: Partial<WeatherSnapshot>): void {
    if (!this._enabled) return;

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
    this._uiAlive = Boolean(this._clockPillRegistration);
    this._render();
  }

  private _connectWeatherBackend(): void {
    this._weatherClient = this._readWeatherClient();
    if (!this._weatherClient) {
      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, {
        available: false,
        hasConnectivity: this._hasConnectivity(),
      });
      return;
    }

    this._pushSignal(this._weatherClient, 'changed', () => this._onWeatherChanged());
    this._pushSignal(this._weatherClient, 'notify::available', () => this._onWeatherChanged());
    if (this._monitor) {
      this._pushSignal(this._monitor, 'notify::connectivity', () => this._onConnectivityChanged());
    }

    this.refreshWeather();
  }

  private _readWeatherClient(): WeatherClient | null {
    const dateMenu = Main.panel.statusArea.dateMenu as unknown as DateMenuWithWeather;
    return dateMenu._weatherItem?._weatherClient ?? null;
  }

  private _createGWeatherSettings(): Gio.Settings | null {
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup(GWEATHER_SCHEMA_ID, true);
    if (!schema) return null;

    return new Gio.Settings({ settings_schema: schema });
  }

  private _pushSignal(
    obj: {
      connect(signal: string, callback: (...args: unknown[]) => void): number;
      disconnect(id: number): void;
    },
    signalName: string,
    callback: (...args: unknown[]) => void,
  ): void {
    this._signals.push({ obj, id: obj.connect(signalName, callback) });
  }

  private _onConnectivityChanged(): void {
    if (!this._enabled) return;

    if (!this._hasConnectivity()) {
      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, {
        available: this._weatherClient?.available ?? true,
        hasConnectivity: false,
      });
      return;
    }

    this._retryCount = 0;
    this.refreshWeather();
  }

  private _onWeatherChanged(): void {
    const weather = this._weatherClient;
    if (!this._enabled || !weather) return;

    if (!weather.available) {
      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, {
        available: false,
        hasConnectivity: this._hasConnectivity(),
      });
      return;
    }

    if (weather.loading) {
      return;
    }

    const snapshot = this._readSnapshotFromWeather(weather);
    if (snapshot) {
      this._retryCount = 0;
      this._clearTimer('_retryTimerId');
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
    if (this._retryTimerId) return;

    this._retryCount++;
    if (this._retryCount > MAX_RETRIES) {
      this.setWeatherSnapshot(GNOME_WEATHER_SOURCE_KEY, {
        available: true,
        hasConnectivity: true,
      });
      return;
    }

    const delay = this._retryCount <= 2 ? 5 : 30;
    this._retryTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, delay, () => {
      this._retryTimerId = 0;
      this.refreshWeather();
      return GLib.SOURCE_REMOVE;
    });
  }

  private _startRefreshTimer(): void {
    this._clearTimer('_refreshTimerId');
    this._refreshTimerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_LOW,
      REFRESH_INTERVAL_SECONDS,
      () => {
        if (this._hasConnectivity()) this.refreshWeather();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  private _syncSnapshot(): void {
    this._snapshot = [...this._snapshotsBySource.values()].at(-1) ?? null;
    this._render();
  }

  private _render(): void {
    if (!this._enabled || !this._uiAlive || !this._panelWidget || !this._icon || !this._label) {
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
    return this._monitor?.connectivity !== Gio.NetworkConnectivity.LOCAL;
  }

  private _clearTimer(prop: '_refreshTimerId' | '_retryTimerId'): void {
    if (!this[prop]) return;
    GLib.source_remove(this[prop]);
    this[prop] = 0;
  }

  private _now(): number {
    return Math.floor(Date.now() / 1000);
  }
}

export const definition: ModuleDefinition = {
  key: 'weather-clock',
  settingsKey: 'module-weather-clock',
  section: 'dock-panel',
  title: _('Weather Clock'),
  subtitle: _('Shows GNOME Weather next to the clock'),
  options: [
    {
      key: AFTER_CLOCK_KEY,
      title: _('Show Weather After Clock'),
      subtitle: _('Place the weather indicator after the clock instead of before it'),
      type: 'switch',
    },
  ],
  factory: (ctx) => new WeatherClock(ctx),
};
