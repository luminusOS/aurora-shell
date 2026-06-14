import '@girs/gjs';

import St from '@girs/st-18';

import type { Module } from '~/module.ts';
import { WeatherClock } from '~/panel/clock/weatherClock/weatherClock.ts';

const DEVTOOL_SOURCE_KEY = 'aurora-devtool';

export class WeatherClockDevTool {
  readonly key = 'weather-clock';
  readonly title = 'Weather Clock';
  readonly iconName = 'weather-clear-symbolic';

  constructor(
    private readonly _getModule: (key: string) => Module | null,
    private readonly _requestMenuRebuild: () => void,
  ) {}

  buildPanel(): St.Widget {
    const weatherClock = this._getWeatherClock();
    const panel = new St.BoxLayout({
      vertical: true,
      style_class: 'aurora-devtool-module-panel',
    });

    const summary = new St.BoxLayout({
      style_class: 'aurora-devtool-summary',
    });
    summary.add_child(
      new St.Icon({
        icon_name: this.iconName,
        icon_size: 18,
        style_class: 'aurora-devtool-summary-icon',
      }),
    );
    summary.add_child(
      new St.Label({
        text: weatherClock
          ? `Visible: ${weatherClock.isVisible ? 'yes' : 'no'}`
          : 'Weather Clock disabled',
        style_class: 'aurora-devtool-summary-label',
        x_expand: true,
      }),
    );
    panel.add_child(summary);

    const firstRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    firstRow.add_child(
      this._createActionButton(
        'weather-clear-symbolic',
        'Sunny',
        () => this.showSunny(),
        !weatherClock,
      ),
    );
    firstRow.add_child(
      this._createActionButton(
        'weather-showers-symbolic',
        'Rain',
        () => this.showRain(),
        !weatherClock,
      ),
    );
    panel.add_child(firstRow);

    const secondRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    secondRow.add_child(
      this._createActionButton(
        'network-offline-symbolic',
        'Offline',
        () => this.showOffline(),
        !weatherClock,
      ),
    );
    panel.add_child(secondRow);

    const thirdRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    thirdRow.add_child(
      this._createActionButton(
        'dialog-warning-symbolic',
        'Unavailable',
        () => this.showUnavailable(),
        !weatherClock,
      ),
    );
    thirdRow.add_child(
      this._createActionButton(
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
    return this._setSnapshot({
      iconName: 'weather-clear-symbolic',
      temperature: '24°',
      description: 'Clear sky',
    });
  }

  showRain(): boolean {
    return this._setSnapshot({
      iconName: 'weather-showers-symbolic',
      temperature: '18°',
      description: 'Rain showers',
    });
  }

  showOffline(): boolean {
    return this._setSnapshot({
      hasConnectivity: false,
    });
  }

  showUnavailable(): boolean {
    return this._setSnapshot({
      available: false,
    });
  }

  clearWeather(): void {
    this._getWeatherClock()?.clearWeatherSnapshot(DEVTOOL_SOURCE_KEY);
    this._requestMenuRebuild();
  }

  get isVisible(): boolean {
    return this._getWeatherClock()?.isVisible ?? false;
  }

  private _setSnapshot(snapshot: Parameters<WeatherClock['setWeatherSnapshot']>[1]): boolean {
    const weatherClock = this._getWeatherClock();
    if (!weatherClock) return false;

    weatherClock.setWeatherSnapshot(DEVTOOL_SOURCE_KEY, snapshot);
    this._requestMenuRebuild();
    return true;
  }

  private _getWeatherClock(): WeatherClock | null {
    const module = this._getModule('weather-clock');
    return module instanceof WeatherClock ? module : null;
  }

  private _createActionButton(
    iconName: string,
    label: string,
    onClick: () => void,
    disabled = false,
  ): St.Button {
    const content = new St.BoxLayout({
      style_class: 'aurora-devtool-action-content',
    });
    content.add_child(
      new St.Icon({
        icon_name: iconName,
        icon_size: 16,
      }),
    );
    content.add_child(new St.Label({ text: label }));

    const button = new St.Button({
      child: content,
      style_class: 'button aurora-devtool-action-button',
      can_focus: !disabled,
      reactive: !disabled,
      x_expand: true,
      accessible_name: label,
    });
    if (disabled) button.opacity = 120;
    button.connect('clicked', onClick);
    return button;
  }
}
