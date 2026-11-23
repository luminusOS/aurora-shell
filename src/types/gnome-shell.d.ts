import type St from '@girs/st-51';
import type GWeather from 'gi://GWeather';
import type GObject from '@girs/gobject-2.0';

declare module '@girs/gnome-shell/ui/popupMenu' {
  interface PopupMenu {
    close(params: { animate?: boolean; fadeOnly?: boolean }): void;
  }
}

declare module '@girs/gnome-shell/ui/dateMenu' {
  interface ShellWeatherClient {
    available: boolean;
    loading: boolean;
    info: GWeather.Info;
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

declare module '@girs/gnome-shell/ui/layout' {
  interface LayoutManager {
    connect: GObject.SignalMethods<this, LayoutManager.SignalSignatures>['connect'];
  }
}

declare module '@girs/gnome-shell/ui/sessionMode' {
  interface SessionMode {
    isLocked: boolean;
    hasOverview: boolean;
    allowSettings: boolean;
  }
}
