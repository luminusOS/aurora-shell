import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createIconWeaveResolutionKey,
  IconWeaveWindowRegistry,
} from '~/patches/iconWeaveRegistry.ts';

function fakeWindow(wmClass: string, appId: string) {
  return {
    get_wm_class: () => wmClass,
    get_gtk_application_id: () => appId,
  };
}

test('icon weave registry exposes current window mappings', () => {
  const registry = new IconWeaveWindowRegistry();
  const application = { id: 'example.desktop' };
  const first = fakeWindow('Example', 'com.example.App');

  registry.map(first, application);

  assert.equal(registry.mappings.get(first), application);
});

test('icon weave registry retains cached resolutions after mappings are removed', () => {
  const registry = new IconWeaveWindowRegistry();
  const application = { id: 'example.desktop' };
  const first = fakeWindow('Example', 'com.example.App');
  const second = fakeWindow('Example', 'com.example.App');
  const key = createIconWeaveResolutionKey('Example', 'com.example.App', 'Example');

  registry.map(first, application);
  registry.map(second, application);
  registry.setResolvedApp(key, 'example.desktop');

  registry.remove(first);
  assert.equal(registry.getResolvedApp(key), 'example.desktop');

  registry.remove(second);
  assert.equal(registry.getResolvedApp(key), 'example.desktop');
});

test('icon weave resolution keys distinguish title-dependent matches', () => {
  const first = createIconWeaveResolutionKey('Example', 'com.example.App', 'First');
  const second = createIconWeaveResolutionKey('Example', 'com.example.App', 'Second');

  assert.notEqual(first, second);
});

test('icon weave registry invalidates resolutions without dropping live mappings', () => {
  const registry = new IconWeaveWindowRegistry();
  const window = fakeWindow('Example', 'com.example.App');
  const key = createIconWeaveResolutionKey('Example', 'com.example.App', 'Example');

  registry.map(window, { id: 'example.desktop' });
  registry.setResolvedApp(key, null);
  registry.clearResolutions();

  assert.equal(registry.mappings.size, 1);
  assert.equal(registry.hasResolved(key), false);
});

test('icon weave registry bounds persistent title resolutions', () => {
  const registry = new IconWeaveWindowRegistry();

  for (let index = 0; index <= 256; index++) {
    registry.setResolvedApp(`key-${index}`, `app-${index}.desktop`);
  }

  assert.equal(registry.hasResolved('key-0'), false);
  assert.equal(registry.getResolvedApp('key-256'), 'app-256.desktop');
});
