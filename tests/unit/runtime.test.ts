import { test } from 'node:test';
import assert from 'node:assert/strict';

import { moduleSupportsRuntime, type ModuleDefinition } from '../../src/module.ts';

function definition(runtime?: ModuleDefinition['runtime']): ModuleDefinition {
  return {
    key: 'test-module',
    settingsKey: 'module-test-module',
    section: 'behavior',
    title: 'Test Module',
    subtitle: 'Runtime test module',
    runtime,
    factory: () => {
      throw new Error('factory should not be called');
    },
  };
}

test('runtime — modules default to desktop only', () => {
  const def = definition();
  assert.equal(moduleSupportsRuntime(def, 'desktop', new Set()), true);
  assert.equal(moduleSupportsRuntime(def, 'mobile', new Set()), false);
});

test('runtime — shared modules support every target', () => {
  const def = definition({ targets: ['shared'] });
  assert.equal(moduleSupportsRuntime(def, 'desktop', new Set()), true);
  assert.equal(moduleSupportsRuntime(def, 'mobile', new Set()), true);
});

test('runtime — required capabilities must be present', () => {
  const def = definition({ targets: ['desktop'], requires: ['backlight'] });
  assert.equal(moduleSupportsRuntime(def, 'desktop', new Set()), false);
  assert.equal(moduleSupportsRuntime(def, 'desktop', new Set(['backlight'])), true);
});
