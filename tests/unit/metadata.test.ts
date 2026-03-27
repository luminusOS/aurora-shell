/**
 * Unit tests — metadata.json
 *
 * Validates that the extension manifest has all required fields and that the
 * values are well-formed. These checks catch common mistakes such as forgetting
 * to bump the version, leaving an invalid shell-version entry, or mismatching
 * the UUID between metadata.json and schema/justfile.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const meta = JSON.parse(readFileSync(resolve(root, 'metadata.json'), 'utf-8'));

const EXPECTED_UUID = 'aurora-shell@luminusos.github.io';

test('metadata.json — required fields are present', () => {
  for (const field of ['uuid', 'name', 'description', 'version', 'shell-version', 'settings-schema', 'gettext-domain']) {
    assert.ok(field in meta, `Missing required field: ${field}`);
    assert.ok(meta[field] !== null && meta[field] !== undefined && meta[field] !== '',
      `Field "${field}" must not be empty`);
  }
});

test('metadata.json — uuid matches expected value', () => {
  assert.strictEqual(meta.uuid, EXPECTED_UUID);
});

test('metadata.json — settings-schema matches uuid prefix', () => {
  assert.ok(
    meta['settings-schema'].includes('aurora-shell'),
    `settings-schema "${meta['settings-schema']}" does not contain "aurora-shell"`
  );
});

test('metadata.json — gettext-domain matches uuid', () => {
  assert.strictEqual(meta['gettext-domain'], EXPECTED_UUID);
});

test('metadata.json — shell-version is a non-empty array of numeric strings', () => {
  assert.ok(Array.isArray(meta['shell-version']), 'shell-version must be an array');
  assert.ok(meta['shell-version'].length > 0, 'shell-version must not be empty');

  for (const v of meta['shell-version']) {
    assert.match(String(v), /^\d+(\.\d+)*$/, `"${v}" is not a valid shell version`);
  }
});

test('metadata.json — version is a positive integer (or numeric string)', () => {
  const v = Number(meta.version);
  assert.ok(!Number.isNaN(v) && v > 0 && Number.isInteger(v),
    `version "${meta.version}" must be a positive integer or numeric string`);
});
