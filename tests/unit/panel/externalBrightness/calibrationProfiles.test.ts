import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findCalibrationProfile,
  PAUSED_PROFILE,
  REPORTED_PROFILE,
  sameCalibrationProfile,
  storeCalibrationProfile,
} from '~/panel/externalBrightness/calibrationProfiles.ts';

const ID = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

test('a stored manual range is restored while the monitor reports the same maximum', () => {
  const stored = storeCalibrationProfile([], ID, { mode: 'manual', min: 0, max: 35 }, 100);

  assert.deepEqual(findCalibrationProfile(stored, ID, 100), { mode: 'manual', min: 0, max: 35 });
});

test('a stored manual range is suspended when the monitor reports another maximum', () => {
  const stored = storeCalibrationProfile([], ID, { mode: 'manual', min: 0, max: 35 }, 100);

  assert.equal(findCalibrationProfile(stored, ID, 60), PAUSED_PROFILE);
});

test('a paused display stays paused, and an unknown display uses its reported range', () => {
  const stored = storeCalibrationProfile([], ID, { mode: 'paused' }, 100);

  assert.equal(findCalibrationProfile(stored, ID, 100), PAUSED_PROFILE);
  assert.equal(findCalibrationProfile(stored, OTHER, 100), REPORTED_PROFILE);
});

test('storing replaces the previous profile, and reported mode removes it', () => {
  let stored = storeCalibrationProfile([], ID, { mode: 'manual', min: 0, max: 35 }, 100);
  stored = storeCalibrationProfile(stored, OTHER, { mode: 'paused' }, 50);
  stored = storeCalibrationProfile(stored, ID, { mode: 'manual', min: 5, max: 30 }, 100);

  assert.equal(stored.length, 2);
  assert.deepEqual(findCalibrationProfile(stored, ID, 100), { mode: 'manual', min: 5, max: 30 });

  stored = storeCalibrationProfile(stored, ID, { mode: 'reported' }, 100);
  assert.equal(findCalibrationProfile(stored, ID, 100), REPORTED_PROFILE);
  assert.equal(findCalibrationProfile(stored, OTHER, 50), PAUSED_PROFILE);
});

test('malformed stored entries are ignored instead of restoring an unsafe range', () => {
  for (const entry of [
    `${ID}:manual:35:0:100`,
    `${ID}:manual:-1:35:100`,
    `${ID}:manual:0:70000:100`,
    `${ID}:manual:0:35`,
    `${ID}:other:0:35:100`,
    'not-an-id:manual:0:35:100',
  ])
    assert.equal(findCalibrationProfile([entry], ID, 100), REPORTED_PROFILE, entry);
});

test('profiles are the same when their mode and manual limits match', () => {
  const manual = { mode: 'manual', min: 5, max: 35 } as const;

  assert.ok(sameCalibrationProfile(manual, { mode: 'manual', min: 5, max: 35 }));
  assert.ok(!sameCalibrationProfile(manual, { mode: 'manual', min: 5, max: 30 }));
  assert.ok(!sameCalibrationProfile(manual, PAUSED_PROFILE));
  assert.ok(sameCalibrationProfile(PAUSED_PROFILE, { mode: 'paused' }));
});
