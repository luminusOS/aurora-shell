export type WeatherClockState = 'showing' | 'offline' | 'unavailable' | 'stale';

export type WeatherSnapshot = {
  iconName: string;
  temperature: string;
  description: string;
  available: boolean;
  hasConnectivity: boolean;
  updatedAtEpochSeconds: number;
};

export type WeatherPresentation = {
  visible: boolean;
  state: WeatherClockState;
  iconName: string;
  label: string;
  description: string;
};

const DEFAULT_STALE_SECONDS = 30 * 60;

function _cleanString(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeWeatherSnapshot(
  snapshot: Partial<WeatherSnapshot>,
  nowEpochSeconds: number,
): WeatherSnapshot {
  return {
    iconName: _cleanString(snapshot.iconName),
    temperature: _cleanString(snapshot.temperature),
    description: _cleanString(snapshot.description),
    available: snapshot.available ?? true,
    hasConnectivity: snapshot.hasConnectivity ?? true,
    updatedAtEpochSeconds: snapshot.updatedAtEpochSeconds ?? nowEpochSeconds,
  };
}

export function deriveWeatherPresentation(
  snapshot: WeatherSnapshot | null,
  nowEpochSeconds: number,
  staleSeconds = DEFAULT_STALE_SECONDS,
): WeatherPresentation {
  if (!snapshot) {
    return {
      visible: false,
      state: 'stale',
      iconName: '',
      label: '',
      description: '',
    };
  }

  if (!snapshot.available) {
    return {
      visible: false,
      state: 'unavailable',
      iconName: '',
      label: '',
      description: '',
    };
  }

  const hasWeather =
    snapshot.iconName.length > 0 &&
    snapshot.iconName !== 'weather-missing-symbolic' &&
    snapshot.temperature.length > 0;

  if (!hasWeather) {
    return {
      visible: false,
      state: snapshot.hasConnectivity ? 'stale' : 'offline',
      iconName: '',
      label: '',
      description: '',
    };
  }

  if (nowEpochSeconds - snapshot.updatedAtEpochSeconds > staleSeconds) {
    return {
      visible: false,
      state: 'stale',
      iconName: '',
      label: '',
      description: '',
    };
  }

  return {
    visible: true,
    state: 'showing',
    iconName: snapshot.iconName,
    label: snapshot.temperature,
    description: snapshot.description,
  };
}
