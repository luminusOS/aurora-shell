/**
 * Unit tests — GSettings schema XML
 *
 * Ensures the GSettings schema is internally consistent and contains an entry
 * for every module key defined in registry.ts.  These are regression tests:
 * adding a new module requires touching registry.ts, extension.ts AND the
 * schema — these tests will fail fast if any of the three is forgotten.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const SCHEMA_FILE = resolve(
  root,
  'data/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml'
);
const SCHEMA_ID = 'org.gnome.shell.extensions.aurora-shell';

// The canonical list of module settings keys; must stay in sync with registry.ts.
const EXPECTED_MODULE_KEYS = [
  'module-no-overview',
  'module-pip-on-top',
  'module-theme-changer',
  'module-dock',
  'module-volume-mixer',
  'module-xwayland-indicator',
  'module-icon-weave',
  'module-app-search-tooltip',
  'module-privacy',
  'module-auto-theme-switcher',
  'module-workspace-thumbnails',
  'module-bluetooth-menu',
] as const;

const schemaXml = readFileSync(SCHEMA_FILE, 'utf-8');

test('schema — file is valid XML and contains the correct schema id', () => {
  assert.ok(schemaXml.startsWith('<?xml'), 'Schema file must start with XML declaration');
  assert.ok(schemaXml.includes(`id="${SCHEMA_ID}"`), `Schema must declare id="${SCHEMA_ID}"`);
});

test('schema — every module key is declared', () => {
  for (const key of EXPECTED_MODULE_KEYS) {
    assert.ok(
      schemaXml.includes(`name="${key}"`),
      `Schema is missing key: "${key}"`
    );
  }
});

test('schema — every module key is boolean type', () => {
  const keyRe = /<key name="(module-[^"]+)" type="([^"]+)"/g;
  let match;
  while ((match = keyRe.exec(schemaXml)) !== null) {
    assert.strictEqual(
      match[2],
      'b',
      `Key "${match[1]}" must be boolean type ("b"), found "${match[2]}"`
    );
  }
});

test('schema — every module key defaults to true', () => {
  // Grab each <key name="module-*"> … </key> block and verify <default>true</default>.
  // Opt-in modules (OPT_IN_MODULE_KEYS) are exempt — they default to false because
  // they require elevated privileges or explicit user consent to activate.
  const blockRe = /<key name="(module-[^"]+)"[^>]*>[\s\S]*?<\/key>/g;
  let match;
  while ((match = blockRe.exec(schemaXml)) !== null) {
    const block = match[0];
    const keyName = match[1];
    const defaultMatch = block.match(/<default>(.*?)<\/default>/);
    assert.ok(defaultMatch, `Key "${keyName}" has no <default> element`);
    assert.strictEqual(
      defaultMatch![1].trim(),
      'true',
      `Key "${keyName}" must default to true`
    );
  }
});

test('schema — no duplicate key names', () => {
  const nameRe = /<key name="([^"]+)"/g;
  const seen = new Set<string>();
  let match;
  while ((match = nameRe.exec(schemaXml)) !== null) {
    assert.ok(!seen.has(match[1]), `Duplicate schema key: "${match[1]}"`);
    seen.add(match[1]);
  }
});

test('schema — every key has a non-empty summary', () => {
  const blockRe = /<key name="([^"]+)"[^>]*>[\s\S]*?<\/key>/g;
  let match;
  while ((match = blockRe.exec(schemaXml)) !== null) {
    const block = match[0];
    const keyName = match[1];
    const summaryMatch = block.match(/<summary>(.*?)<\/summary>/);
    assert.ok(summaryMatch, `Key "${keyName}" is missing a <summary>`);
    assert.ok(summaryMatch![1].trim().length > 0, `Key "${keyName}" has an empty <summary>`);
  }
});

test('schema — auto-theme-switcher option keys exist with correct types and defaults', () => {
  const optionKeys: Array<{ name: string; type: string; defaultValue: string }> = [
    { name: 'auto-theme-switcher-light-hours', type: 'i', defaultValue: '6' },
    { name: 'auto-theme-switcher-light-minutes', type: 'i', defaultValue: '0' },
    { name: 'auto-theme-switcher-dark-hours', type: 'i', defaultValue: '20' },
    { name: 'auto-theme-switcher-dark-minutes', type: 'i', defaultValue: '0' },
  ];

  for (const { name, type, defaultValue } of optionKeys) {
    assert.ok(schemaXml.includes(`name="${name}"`), `Schema missing key: "${name}"`);
    const blockRe = new RegExp(`<key name="${name}"[^>]*>[\\s\\S]*?<\\/key>`);
    const block = schemaXml.match(blockRe);
    assert.ok(block, `Could not extract block for key "${name}"`);
    assert.ok(block![0].includes(`type="${type}"`), `Key "${name}" must be type "${type}"`);
    assert.ok(block![0].includes(`<default>${defaultValue}</default>`), `Key "${name}" must default to ${defaultValue}`);
  }
});
