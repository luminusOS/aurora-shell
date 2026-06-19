import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveWeatherPresentation,
  normalizeWeatherSnapshot,
  type WeatherSnapshot,
} from '../../src/panel/clock/weatherClock/weatherClockLogic.ts';

const NOW = 1_700_000_000;

function snapshot(overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return normalizeWeatherSnapshot(
    {
      iconName: 'weather-clear-symbolic',
      temperature: '24°',
      description: 'Clear sky',
      available: true,
      hasConnectivity: true,
      ...overrides,
    },
    NOW,
  );
}

test('weatherClock — normalizes partial snapshots with safe defaults', () => {
  const normalized = normalizeWeatherSnapshot({ temperature: ' 24° ' }, NOW);

  assert.strictEqual(normalized.temperature, '24°');
  assert.strictEqual(normalized.available, true);
  assert.strictEqual(normalized.hasConnectivity, true);
  assert.strictEqual(normalized.updatedAtEpochSeconds, NOW);
});

test('weatherClock — shows valid weather snapshots', () => {
  const presentation = deriveWeatherPresentation(snapshot(), NOW);

  assert.strictEqual(presentation.visible, true);
  assert.strictEqual(presentation.state, 'showing');
  assert.strictEqual(presentation.iconName, 'weather-clear-symbolic');
  assert.strictEqual(presentation.label, '24°');
});

test('weatherClock — hides unavailable, offline, missing, and stale snapshots', () => {
  assert.strictEqual(
    deriveWeatherPresentation(snapshot({ available: false }), NOW).state,
    'unavailable',
  );
  assert.strictEqual(
    deriveWeatherPresentation(snapshot({ iconName: '', hasConnectivity: false }), NOW).state,
    'offline',
  );
  assert.strictEqual(
    deriveWeatherPresentation(snapshot({ iconName: 'weather-missing-symbolic' }), NOW).state,
    'stale',
  );
  assert.strictEqual(
    deriveWeatherPresentation(snapshot({ updatedAtEpochSeconds: NOW - 3600 }), NOW).state,
    'stale',
  );
});
