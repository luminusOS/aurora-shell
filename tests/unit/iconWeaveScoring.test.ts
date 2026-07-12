import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreIconWeaveCandidate } from '../../src/patches/iconWeaveScoring.ts';

const MIN_MATCH_SCORE = 50;

test('IconWeave scoring rejects helper classes that only share a generic short token', () => {
  const score = scoreIconWeaveCandidate({
    desktopId: 'io.ente.auth',
    appName: 'Ente Auth',
    wmClass: 'nm-openconnect-auth-dialog',
    appId: '',
    title: 'Authentication Required',
  });

  assert.equal(score, 0);
});

test('IconWeave scoring keeps exact identity matches strong', () => {
  const score = scoreIconWeaveCandidate({
    desktopId: 'io.ente.auth',
    appName: 'Ente Auth',
    wmClass: 'io.ente.auth',
    appId: '',
    title: '',
  });

  assert.ok(score >= MIN_MATCH_SCORE);
});

test('IconWeave scoring keeps compact short-id variants matchable', () => {
  const score = scoreIconWeaveCandidate({
    desktopId: 'com.discordapp.Discord',
    appName: 'Discord',
    wmClass: 'discordcanary',
    appId: '',
    title: '',
  });

  assert.ok(score >= MIN_MATCH_SCORE);
});
