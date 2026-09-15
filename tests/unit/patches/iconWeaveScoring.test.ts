import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIconWeaveCandidateMetadata,
  isIconWeaveSteamGame,
  registerIconWeaveWindow,
  scoreIconWeaveCandidate,
  unregisterIconWeaveWindow,
} from '~/patches/iconWeaveScoring.ts';

const MIN_MATCH_SCORE = 50;

function candidate(desktopId: string, appName: string, executable = '') {
  return createIconWeaveCandidateMetadata(desktopId, appName, executable);
}

test('IconWeave scoring rejects helper classes that only share a generic short token', () => {
  const score = scoreIconWeaveCandidate({
    candidate: candidate('io.ente.auth', 'Ente Auth'),
    wmClass: 'nm-openconnect-auth-dialog',
    appId: '',
    title: 'Authentication Required',
  });

  assert.equal(score, 0);
});

test('IconWeave registration updates immutably and removes mapped windows', () => {
  const initial = new Map([[1, 'one.desktop']]);
  const registered = registerIconWeaveWindow(initial, { windowId: 2, appId: 'two.desktop' });
  assert.equal(initial.has(2), false);
  assert.equal(registered.get(2), 'two.desktop');
  assert.deepEqual([...unregisterIconWeaveWindow(registered, 1)], [[2, 'two.desktop']]);
});

test('IconWeave scoring keeps exact identity matches strong', () => {
  const score = scoreIconWeaveCandidate({
    candidate: candidate('io.ente.auth', 'Ente Auth'),
    wmClass: 'io.ente.auth',
    appId: '',
    title: '',
  });

  assert.ok(score >= MIN_MATCH_SCORE);
});

test('IconWeave scoring keeps compact short-id variants matchable', () => {
  const score = scoreIconWeaveCandidate({
    candidate: candidate('com.discordapp.Discord', 'Discord'),
    wmClass: 'discordcanary',
    appId: '',
    title: '',
  });

  assert.ok(score >= MIN_MATCH_SCORE);
});

test('IconWeave candidate metadata normalizes desktop identity once', () => {
  const metadata = candidate(
    'Com.ValveSoftware.Game.desktop',
    'Half-Life 2',
    'steam steam://rungameid/220',
  );

  assert.deepEqual(metadata, {
    desktopId: 'com.valvesoftware.game',
    appName: 'half-life 2',
    shortId: 'game',
    normalizedDesktopId: 'comvalvesoftwaregame',
    normalizedAppName: 'halflife2',
    normalizedShortId: 'game',
    abbreviation: 'hl2',
    steamGameId: '220',
  });
});

test('IconWeave Steam matching uses cached Exec ID and name abbreviation', () => {
  const metadata = candidate('half-life-2.desktop', 'Half-Life 2', 'steam://rungameid/220');

  assert.equal(isIconWeaveSteamGame(metadata, 'steam_app_220'), true);
  assert.equal(isIconWeaveSteamGame(metadata, 'hl2'), true);
  assert.equal(isIconWeaveSteamGame(metadata, 'steam_app_221'), false);
  assert.equal(isIconWeaveSteamGame(candidate('half-life-2.desktop', 'Half-Life 2'), 'hl2'), false);
});

test('IconWeave Steam identity takes precedence over ordinary candidate scoring', () => {
  const metadata = candidate(
    'com.valvesoftware.steam-app-220.desktop',
    'Half-Life 2',
    'steam://rungameid/220',
  );
  const ordinaryScore = scoreIconWeaveCandidate({
    candidate: metadata,
    wmClass: 'steam_app_220',
    appId: '',
    title: '',
  });

  assert.equal(isIconWeaveSteamGame(metadata, 'steam_app_220'), true);
  assert.equal(ordinaryScore, 99);
});
