/**
 * Regression tests — Module registry consistency
 *
 * Adding a new module requires edits in:
 *   1. src/modules/<module>.ts  — `definition` export (metadata + factory, co-located with class)
 *   2. src/registry.ts          — one import line + one entry in getModuleRegistry()
 *   3. src/prefsMetadata.ts     — metadata entry (prefs runs in a different process and
 *                                 cannot statically import modules that reference shell internals)
 *   4. data/schemas/…           — GSettings key  (covered by schema.test.ts)
 *
 * These tests parse the TypeScript source as text (no GJS runtime needed) and
 * cross-check that registry, prefsMetadata, module definitions, and the schema
 * are in sync, so a half-finished module addition is caught immediately in CI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------------------
// Source parsers
// ---------------------------------------------------------------------------

/** Extract { key, settingsKey } pairs from any source file. */
function parseEntriesFromSource(src: string): { key: string; settingsKey: string }[] {
  const entries: { key: string; settingsKey: string }[] = [];
  const blockRe = /key:\s*'([^']+)',\s*settingsKey:\s*'([^']+)'/g;
  let m;
  while ((m = blockRe.exec(src)) !== null) entries.push({ key: m[1], settingsKey: m[2] });
  return entries;
}

/** Parse the module entries from registry.ts (full ModuleDefinition, includes factory). */
function parseRegistryEntries(): { key: string; settingsKey: string }[] {
  // registry.ts aggregates via imports; parse each module file's `definition`
  // block referenced by the registry's returned array to derive keys.
  return collectEntriesFromModuleFiles();
}

/** Recursively walk `src/modules/` and collect `definition` blocks. */
function collectEntriesFromModuleFiles(): { key: string; settingsKey: string }[] {
  const modulesDir = resolve(root, 'src/modules');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full);
    }
  };
  walk(modulesDir);

  const entries: { key: string; settingsKey: string }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    if (!src.includes('export const definition')) continue;
    entries.push(...parseEntriesFromSource(src));
  }
  return entries;
}

/** Parse `getModuleMetadata()` entries from prefsMetadata.ts. */
function parsePrefsMetadataEntries(): { key: string; settingsKey: string }[] {
  const src = readFileSync(resolve(root, 'src/prefsMetadata.ts'), 'utf-8');
  return parseEntriesFromSource(src);
}

/** Parse registry.ts returned array order — keys in emission order. */
function parseRegistryOrder(): string[] {
  const src = readFileSync(resolve(root, 'src/registry.ts'), 'utf-8');
  const importRe = /import\s*\{\s*definition\s+as\s+(\w+)\s*\}\s*from\s*'[^']+'/g;
  const importedAliases = new Set<string>();
  let m;
  while ((m = importRe.exec(src)) !== null) importedAliases.add(m[1]);

  const returnMatch = src.match(/return\s*\[([\s\S]*?)\];/);
  if (!returnMatch) throw new Error('Could not locate registry return array');
  const returnBody = returnMatch[1];
  const order: string[] = [];
  const aliasRe = /\b(\w+)\b/g;
  let a;
  while ((a = aliasRe.exec(returnBody)) !== null) {
    if (importedAliases.has(a[1])) order.push(a[1]);
  }
  return order;
}

/** Parse key order from prefsMetadata.ts. */
function parsePrefsMetadataOrder(): string[] {
  return parsePrefsMetadataEntries().map((e) => e.key);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const registryEntries = parseRegistryEntries();
const prefsEntries = parsePrefsMetadataEntries();
const registryKeys = registryEntries.map((e) => e.key);
const registrySettingsKeys = registryEntries.map((e) => e.settingsKey);
const prefsKeys = prefsEntries.map((e) => e.key);

test('registry — at least one module is registered', () => {
  assert.ok(registryEntries.length > 0, 'Registry has no entries');
});

test('registry — module keys are unique', () => {
  assert.strictEqual(
    new Set(registryKeys).size,
    registryKeys.length,
    `Duplicate module keys: ${registryKeys.filter((k, i) => registryKeys.indexOf(k) !== i)}`,
  );
});

test('registry — settingsKeys are unique', () => {
  assert.strictEqual(
    new Set(registrySettingsKeys).size,
    registrySettingsKeys.length,
    `Duplicate settingsKeys: ${registrySettingsKeys.filter((k, i) => registrySettingsKeys.indexOf(k) !== i)}`,
  );
});

test('registry — all settingsKeys follow the "module-" prefix convention', () => {
  for (const { settingsKey } of registryEntries) {
    assert.match(
      settingsKey,
      /^module-/,
      `settingsKey "${settingsKey}" does not start with "module-"`,
    );
  }
});

test('registry ↔ prefsMetadata — every module key is mirrored in prefsMetadata', () => {
  for (const key of registryKeys) {
    assert.ok(
      prefsKeys.includes(key),
      `Module "${key}" is missing from src/prefsMetadata.ts (prefs UI will skip it)`,
    );
  }
});

test('registry ↔ prefsMetadata — every prefsMetadata key has a module definition', () => {
  for (const key of prefsKeys) {
    assert.ok(
      registryKeys.includes(key),
      `prefsMetadata key "${key}" has no corresponding module definition`,
    );
  }
});

test('registry ↔ prefsMetadata — settingsKeys match for the same module key', () => {
  const regMap = new Map(registryEntries.map((e) => [e.key, e.settingsKey]));
  for (const { key, settingsKey } of prefsEntries) {
    assert.strictEqual(
      regMap.get(key),
      settingsKey,
      `prefsMetadata key "${key}" has settingsKey "${settingsKey}" but registry has "${regMap.get(key)}"`,
    );
  }
});

test('registry ↔ prefsMetadata — presentation order is identical', () => {
  // Order matters: prefs UI renders modules in prefsMetadata order; the runtime
  // iterates registry order. If they diverge the visible/enable sequences drift.
  const regOrder = parseRegistryOrder();
  const prefsOrder = parsePrefsMetadataOrder();
  // Registry order comes from import-alias names (camelCase); prefs order comes
  // from kebab-case keys. Normalise both to the kebab-case key via registry map.
  const aliasToKey = new Map<string, string>();
  const src = readFileSync(resolve(root, 'src/registry.ts'), 'utf-8');
  const importRe = /import\s*\{\s*definition\s+as\s+(\w+)\s*\}\s*from\s*'([^']+)'/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const alias = m[1];
    const path = m[2];
    const moduleFile = resolve(
      root,
      path.replace('~', 'src').replace(/\.ts$/, '.ts'),
    );
    const modSrc = readFileSync(moduleFile, 'utf-8');
    const keyMatch = modSrc.match(/key:\s*'([^']+)'/);
    if (keyMatch) aliasToKey.set(alias, keyMatch[1]);
  }
  const regOrderKeys = regOrder.map((a) => aliasToKey.get(a)!).filter(Boolean);
  assert.deepStrictEqual(
    prefsOrder,
    regOrderKeys,
    'prefsMetadata order must match registry.ts import/return order',
  );
});

test('registry ↔ schema — every settingsKey is declared in the schema XML', () => {
  const schemaXml = readFileSync(
    resolve(root, 'data/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml'),
    'utf-8',
  );
  for (const { settingsKey } of registryEntries) {
    assert.ok(
      schemaXml.includes(`name="${settingsKey}"`),
      `settingsKey "${settingsKey}" is not declared in the GSettings schema`,
    );
  }
});

test('registry — every registry import resolves to a module file that exports a definition', () => {
  const src = readFileSync(resolve(root, 'src/registry.ts'), 'utf-8');
  const importRe = /import\s*\{\s*definition\s+as\s+\w+\s*\}\s*from\s*'([^']+)'/g;
  let m;
  let count = 0;
  while ((m = importRe.exec(src)) !== null) {
    const path = m[1];
    const moduleFile = resolve(root, path.replace('~', 'src'));
    const modSrc = readFileSync(moduleFile, 'utf-8');
    assert.match(
      modSrc,
      /export const definition:\s*ModuleDefinition/,
      `Module file ${path} must export \`definition: ModuleDefinition\``,
    );
    count++;
  }
  assert.ok(count > 0, 'registry.ts has no `import { definition as … }` entries');
});
