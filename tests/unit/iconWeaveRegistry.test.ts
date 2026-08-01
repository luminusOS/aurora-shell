import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IconWeaveWindowRegistry } from '../../src/patches/iconWeaveRegistry.ts';

function fakeWindow(wmClass: string, appId: string) {
  return {
    get_wm_class: () => wmClass,
    get_gtk_application_id: () => appId,
  };
}

test('icon weave registry reuses mappings with the same application identity', () => {
  const registry = new IconWeaveWindowRegistry();
  const application = { id: 'example.desktop' };
  const first = fakeWindow('Example', 'com.example.App');

  registry.map(first, application);

  assert.equal(registry.findMappedApp('Example', ''), application);
  assert.equal(registry.findMappedApp('', 'com.example.App'), application);
  assert.equal(registry.findMappedApp('Different', 'different.app'), null);
});

test('icon weave registry retains a processed identity until its last mapping is removed', () => {
  const registry = new IconWeaveWindowRegistry();
  const application = { id: 'example.desktop' };
  const first = fakeWindow('Example', 'com.example.App');
  const second = fakeWindow('Example', 'com.example.App');

  registry.map(first, application);
  registry.map(second, application);
  registry.markProcessed('Example');

  registry.remove(first, 'Example', 'com.example.App');
  assert.equal(registry.hasProcessed('Example'), true);

  registry.remove(second, 'Example', 'com.example.App');
  assert.equal(registry.hasProcessed('Example'), false);
});

test('icon weave registry clears mappings and processed identities together', () => {
  const registry = new IconWeaveWindowRegistry();
  const window = fakeWindow('Example', 'com.example.App');

  registry.map(window, { id: 'example.desktop' });
  registry.markProcessed('Example');
  registry.clear();

  assert.equal(registry.mappings.size, 0);
  assert.equal(registry.hasProcessed('Example'), false);
});
