import '@girs/gjs';

import { action, type RuntimeAction } from './protocol.ts';
import type { Module } from '~/module.ts';
import { WeatherClock } from '~/panel/clock/weatherClock/weatherClock.ts';
import { gettext as _ } from '~/shared/i18n.ts';

const DEVTOOL_SOURCE_KEY = 'aurora-devtool';

export class WeatherClockDevTool {
  readonly key = 'weather-clock';
  readonly title = 'Weather Clock';

  private _preview = _('No fake weather');
  private _previewOwner: WeatherClock | null = null;

  constructor(private readonly _getModule: (key: string) => Module | null) {}

  describe() {
    const weatherClock = this._getWeatherClock();
    if (weatherClock !== this._previewOwner) {
      this._preview = _('No fake weather');
      this._previewOwner = null;
    }
    const actions: RuntimeAction[] = [];
    const details: string[] = [];
    details.push(
      weatherClock ? `Visible: ${weatherClock.isVisible ? 'yes' : 'no'}` : 'Weather Clock disabled',
    );
    details.push(this._preview);

    actions.push(action('showSunny', 'Sunny', () => this.showSunny(), !weatherClock));
    actions.push(action('showRain', 'Rain', () => this.showRain(), !weatherClock));

    actions.push(action('showOffline', 'Offline', () => this.showOffline(), !weatherClock));

    actions.push(
      action('showUnavailable', 'Unavailable', () => this.showUnavailable(), !weatherClock),
    );
    actions.push(action('clearWeather', 'Clear Fake', () => this.clearWeather(), !weatherClock));

    return { details, actions };
  }

  destroy(): void {
    this.clearWeather();
  }

  showSunny(): boolean {
    return this._setSnapshot(
      {
        iconName: 'weather-clear-symbolic',
        temperature: '24°',
        description: 'Clear sky',
      },
      '24° · Clear sky',
    );
  }

  showRain(): boolean {
    return this._setSnapshot(
      {
        iconName: 'weather-showers-symbolic',
        temperature: '18°',
        description: 'Rain showers',
      },
      '18° · Rain showers',
    );
  }

  showOffline(): boolean {
    return this._setSnapshot({ hasConnectivity: false }, _('Offline'));
  }

  showUnavailable(): boolean {
    return this._setSnapshot({ available: false }, _('Weather service unavailable'));
  }

  clearWeather(): void {
    const weatherClock = this._getWeatherClock();
    if (weatherClock) weatherClock.clearWeatherSnapshot(DEVTOOL_SOURCE_KEY);

    this._preview = _('No fake weather');
    this._previewOwner = null;
  }

  get isVisible(): boolean {
    const weatherClock = this._getWeatherClock();
    if (!weatherClock) return false;

    return weatherClock.isVisible;
  }

  private _setSnapshot(
    snapshot: Parameters<WeatherClock['setWeatherSnapshot']>[1],
    preview: string,
  ): boolean {
    const weatherClock = this._getWeatherClock();
    if (!weatherClock) return false;

    weatherClock.setWeatherSnapshot(DEVTOOL_SOURCE_KEY, snapshot);
    this._preview = preview;
    this._previewOwner = weatherClock;
    return true;
  }

  private _getWeatherClock(): WeatherClock | null {
    const module = this._getModule('weather-clock');
    return module instanceof WeatherClock ? module : null;
  }
}
