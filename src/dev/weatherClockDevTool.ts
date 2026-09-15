import '@girs/gjs';

import type St from '@girs/st-18';

import {
  createDevToolActionButton,
  createDevToolActionRow,
  createDevToolModulePanel,
  createDevToolSummary,
} from '~/dev/devToolUi.ts';
import type { Module } from '~/module.ts';
import { WeatherClock } from '~/panel/clock/weatherClock/weatherClock.ts';
import { gettext as _ } from '~/shared/i18n.ts';

const DEVTOOL_SOURCE_KEY = 'aurora-devtool';

export class WeatherClockDevTool {
  readonly key = 'weather-clock';
  readonly title = 'Weather Clock';
  readonly iconName = 'weather-clear-symbolic';

  private _preview = _('No fake weather');
  private _previewOwner: WeatherClock | null = null;

  constructor(
    private readonly _getModule: (key: string) => Module | null,
    private readonly _requestMenuRebuild: () => void,
  ) {}

  buildPanel(): St.Widget {
    const weatherClock = this._getWeatherClock();
    if (weatherClock !== this._previewOwner) {
      this._preview = _('No fake weather');
      this._previewOwner = null;
    }
    const panel = createDevToolModulePanel();
    panel.add_child(
      createDevToolSummary(
        this.iconName,
        weatherClock
          ? `Visible: ${weatherClock.isVisible ? 'yes' : 'no'}`
          : 'Weather Clock disabled',
      ),
    );
    panel.add_child(createDevToolSummary('weather-severe-alerts-symbolic', this._preview));

    const firstRow = createDevToolActionRow();
    firstRow.add_child(
      createDevToolActionButton(
        'weather-clear-symbolic',
        'Sunny',
        () => this.showSunny(),
        !weatherClock,
      ),
    );
    firstRow.add_child(
      createDevToolActionButton(
        'weather-showers-symbolic',
        'Rain',
        () => this.showRain(),
        !weatherClock,
      ),
    );
    panel.add_child(firstRow);

    const secondRow = createDevToolActionRow();
    secondRow.add_child(
      createDevToolActionButton(
        'network-offline-symbolic',
        'Offline',
        () => this.showOffline(),
        !weatherClock,
      ),
    );
    panel.add_child(secondRow);

    const thirdRow = createDevToolActionRow();
    thirdRow.add_child(
      createDevToolActionButton(
        'dialog-warning-symbolic',
        'Unavailable',
        () => this.showUnavailable(),
        !weatherClock,
      ),
    );
    thirdRow.add_child(
      createDevToolActionButton(
        'user-trash-symbolic',
        'Clear Fake',
        () => this.clearWeather(),
        !weatherClock,
      ),
    );
    panel.add_child(thirdRow);

    return panel;
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
    this._requestMenuRebuild();
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
    this._requestMenuRebuild();
    return true;
  }

  private _getWeatherClock(): WeatherClock | null {
    const module = this._getModule('weather-clock');
    return module instanceof WeatherClock ? module : null;
  }
}
