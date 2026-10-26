import { parseBrightnessRange } from './brightnessCalibration.ts';

export const CALIBRATIONS_KEY = 'external-brightness-calibrations';

/** How one display's brightness is mapped, as chosen in the calibration preferences. */
export type CalibrationProfile =
  | { mode: 'reported' }
  | { mode: 'paused' }
  | { mode: 'manual'; min: number; max: number };

// Shared instances, so reported and paused profiles also compare equal by identity.
export const REPORTED_PROFILE: CalibrationProfile = Object.freeze({ mode: 'reported' });
export const PAUSED_PROFILE: CalibrationProfile = Object.freeze({ mode: 'paused' });

/**
 * The stored profile for a display, with entries `<id>:<mode>:<min>:<max>:<reported max>`
 * keyed by a SHA-256 of the monitor model. A display without a valid entry uses its reported range.
 *
 * A manual range only applies while the display reports the maximum it was calibrated against;
 * otherwise the display is paused rather than written with limits meant for another scale.
 */
export function findCalibrationProfile(
  stored: readonly string[],
  displayId: string,
  reportedMax: number,
): CalibrationProfile {
  for (const entry of stored) {
    const fields = entry.split(':');
    if (fields.length !== 5 || fields[0] !== displayId) continue;

    const [, mode, min, max, calibratedMax] = fields;
    if (mode === 'paused') return PAUSED_PROFILE;
    if (mode !== 'manual') continue;

    const range = parseBrightnessRange(min!, max!);
    if (!range) continue;

    if (calibratedMax !== String(reportedMax)) return PAUSED_PROFILE;
    return { mode: 'manual', ...range };
  }

  return REPORTED_PROFILE;
}

export function sameCalibrationProfile(a: CalibrationProfile, b: CalibrationProfile): boolean {
  if (a.mode === 'manual' && b.mode === 'manual') return a.min === b.min && a.max === b.max;

  return a.mode === b.mode;
}

/** Returns `stored` with the display's profile replaced; the reported mode removes the entry. */
export function storeCalibrationProfile(
  stored: readonly string[],
  displayId: string,
  profile: CalibrationProfile,
  reportedMax: number,
): string[] {
  const others = stored.filter((entry) => entry.split(':')[0] !== displayId);
  if (profile.mode === 'reported') return others;

  const [min, max] = profile.mode === 'manual' ? [profile.min, profile.max] : [0, 0];
  return [...others, [displayId, profile.mode, min, max, reportedMax].join(':')];
}
