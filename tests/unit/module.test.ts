import assert from 'node:assert/strict';
import { test } from 'node:test';

import { moduleSupportsRuntime, type ModuleManifest } from '~/module.ts';

function manifest(runtime?: ModuleManifest['runtime']): ModuleManifest {
  return {
    key: 'test-module',
    settingsKey: 'module-test-module',
    section: 'behavior',
    title: 'Test Module',
    subtitle: 'Runtime test module',
    runtime,
  };
}

test('runtime: modules default to desktop role', () => {
  const item = manifest();
  assert.equal(moduleSupportsRuntime(item, new Set(['desktop']), new Set()), true);
  assert.equal(moduleSupportsRuntime(item, new Set(['mobile']), new Set()), false);
});

test('runtime: a manifest supports both roles explicitly', () => {
  const item = manifest({ roles: ['desktop', 'mobile'] });
  assert.equal(moduleSupportsRuntime(item, new Set(['desktop']), new Set()), true);
  assert.equal(moduleSupportsRuntime(item, new Set(['mobile']), new Set()), true);
});

test('runtime: required capabilities must be present', () => {
  const item = manifest({ roles: ['desktop'], requires: ['backlight'] });
  assert.equal(moduleSupportsRuntime(item, new Set(['desktop']), new Set()), false);
  assert.equal(moduleSupportsRuntime(item, new Set(['desktop']), new Set(['backlight'])), true);
});
