import type St from '@girs/st-18';
import type GWeather from 'gi://GWeather';
import type { Button } from '@girs/gnome-shell/ui/panelMenu';

declare module '@girs/gnome-shell/ui/dateMenu' {
  interface ShellWeatherClient {
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
  }

  interface DateMenuButton {
    _clockDisplay: St.Label;
    _weatherItem?: {
      _weatherClient?: ShellWeatherClient;
    };
  }
}

declare module '@girs/gnome-shell/ui/panel' {
  interface Panel {
    addToStatusArea<T extends Omit<Button, '_init'>>(
      role: string,
      indicator: T,
      position?: number,
      box?: 'left' | 'center' | 'right',
    ): T;
  }
}
