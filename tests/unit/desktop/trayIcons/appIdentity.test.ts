import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appIdCandidates, sniIdentityMatchesAppId } from '~/desktop/trayIcons/appIdentity.ts';

test('app identity — keeps suffixed and unsuffixed lowercase candidates', () => {
  assert.deepEqual(
    appIdCandidates(['Org.Example.App.desktop']),
    new Set(['org.example.app.desktop', 'org.example.app']),
  );
});

test('app identity — matches specific SNI metadata without generic component collisions', () => {
  assert.equal(
    sniIdentityMatchesAppId(
      { desktopEntry: 'com.discordapp.Discord.desktop', sniId: '' },
      'com.discordapp.Discord',
    ),
    true,
  );
  assert.equal(
    sniIdentityMatchesAppId({ desktopEntry: '', sniId: 'org.example.tray' }, 'com.other.tray'),
    false,
  );
});

test('app identity — combines candidates from Shell and background-app IDs', () => {
  assert.deepEqual(
    appIdCandidates(['org.example.App', 'Com.Vendor.App.desktop']),
    new Set(['org.example.app', 'com.vendor.app.desktop', 'com.vendor.app']),
  );
});

test('app identity — ignores empty IDs and deduplicates equivalent forms', () => {
  assert.deepEqual(
    appIdCandidates(['', 'app.desktop', 'APP.desktop']),
    new Set(['app.desktop', 'app']),
  );
});
