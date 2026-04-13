/**
 * Regression tests — Module registry consistency
 *
 * Adding a new module requires edits in three places:
 *   1. src/registry.ts  — getModuleRegistry() entry
 *   2. src/extension.ts — MODULE_FACTORIES entry
 *   3. data/schemas/…   — GSettings key  (covered by schema.test.ts)
 *
 * These tests parse the TypeScript source as text (no GJS runtime needed) and
 * cross-check that registry and MODULE_FACTORIES are in sync, so a half-finished
 * module addition is caught immediately in CI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------------------
// Source parsers
// ---------------------------------------------------------------------------

/** Extract { key, settingsKey } pairs from registry.ts source text. */
function parseRegistryEntries(): { key: string; settingsKey: string }[] {
  const src = readFileSync(resolve(root, 'src/registry.ts'), 'utf-8');
  const entries: { key: string; settingsKey: string }[] = [];

  // Each object literal in the array has the form:
  //   { key: 'foo', settingsKey: 'module-foo', … }
  const blockRe = /\{\s*key:\s*'([^']+)',\s*settingsKey:\s*'([^']+)'/g;
  let m;
  while ((m = blockRe.exec(src)) !== null)
    entries.push({ key: m[1], settingsKey: m[2] });

  return entries;
}

/** Extract key names from MODULE_FACTORIES in extension.ts. */
function parseFactoryKeys(): string[] {
  const src = readFileSync(resolve(root, 'src/extension.ts'), 'utf-8');

  // Grab the MODULE_FACTORIES object body
  const factoriesMatch = src.match(/MODULE_FACTORIES[^{]*\{([\s\S]*?)\};/);
  if (!factoriesMatch)
    throw new Error('Could not locate MODULE_FACTORIES in extension.ts');

  const body = factoriesMatch[1];
  // Match both quoted keys ('no-overview': () => ...) and unquoted keys (dock: () => ...)
  const keyRe = /'?([^',\s:]+)'?\s*:\s*\([^)]*\)/g;
  const keys: string[] = [];
  let m;
  while ((m = keyRe.exec(body)) !== null)
    keys.push(m[1]);

  return keys;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const registryEntries = parseRegistryEntries();
const factoryKeys = parseFactoryKeys();
const registryKeys = registryEntries.map(e => e.key);
const registrySettingsKeys = registryEntries.map(e => e.settingsKey);

test('registry — at least one module is registered', () => {
  assert.ok(registryEntries.length > 0, 'Registry has no entries');
});

test('registry — module keys are unique', () => {
  assert.strictEqual(
    new Set(registryKeys).size,
    registryKeys.length,
    `Duplicate module keys: ${registryKeys.filter((k, i) => registryKeys.indexOf(k) !== i)}`
  );
});

test('registry — settingsKeys are unique', () => {
  assert.strictEqual(
    new Set(registrySettingsKeys).size,
    registrySettingsKeys.length,
    `Duplicate settingsKeys: ${registrySettingsKeys.filter((k, i) => registrySettingsKeys.indexOf(k) !== i)}`
  );
});

test('registry — all settingsKeys follow the "module-" prefix convention', () => {
  for (const { settingsKey } of registryEntries) {
    assert.match(
      settingsKey,
      /^module-/,
      `settingsKey "${settingsKey}" does not start with "module-"`
    );
  }
});

test('registry ↔ MODULE_FACTORIES — every registry key has a factory', () => {
  for (const key of registryKeys) {
    assert.ok(
      factoryKeys.includes(key),
      `Registry key "${key}" has no corresponding entry in MODULE_FACTORIES`
    );
  }
});

test('registry ↔ MODULE_FACTORIES — every factory has a registry entry', () => {
  for (const key of factoryKeys) {
    assert.ok(
      registryKeys.includes(key),
      `MODULE_FACTORIES key "${key}" has no corresponding entry in getModuleRegistry()`
    );
  }
});

test('registry ↔ schema — every settingsKey is declared in the schema XML', () => {
  const schemaXml = readFileSync(
    resolve(root, 'data/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml'),
    'utf-8'
  );
  for (const { settingsKey } of registryEntries) {
    assert.ok(
      schemaXml.includes(`name="${settingsKey}"`),
      `settingsKey "${settingsKey}" is not declared in the GSettings schema`
    );
  }
});
