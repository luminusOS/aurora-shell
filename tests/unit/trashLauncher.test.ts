import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canLaunchTrash,
  launchTrash,
  NAUTILUS_APP_ID,
  TRASH_URI,
} from '../../src/dock/trashLauncher.ts';

test('trash URI matches the GVfs location used by Dash to Dock', () => {
  assert.equal(TRASH_URI, 'trash://');
});

test('Nautilus app id is the only supported file manager for trash', () => {
  assert.equal(NAUTILUS_APP_ID, 'org.gnome.Nautilus.desktop');
});

test('launchTrash opens the trash through Nautilus', () => {
  const result = launchTrash({
    launchNautilus: () => true,
  });

  assert.equal(result, 'nautilus');
});

test('canLaunchTrash requires a Nautilus executable', () => {
  assert.equal(canLaunchTrash({ getNautilusExecutable: () => 'nautilus' }), true);
  assert.equal(canLaunchTrash({ getNautilusExecutable: () => null }), false);
});

test('launchTrash does not try alternate file managers when Nautilus is unavailable', () => {
  assert.throws(
    () =>
      launchTrash({
        launchNautilus: () => false,
      }),
    /Nautilus refused the trash URI/,
  );
});

test('launchTrash reports Nautilus launch errors', () => {
  assert.throws(
    () =>
      launchTrash({
        launchNautilus: () => {
          throw new Error('Nautilus unavailable');
        },
      }),
    /Nautilus unavailable/,
  );
});
