import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  selectExternalStorageEntries,
  type ExternalStorageCandidate,
} from '~/dock/externalStorageModel.ts';

function candidate(overrides: Partial<ExternalStorageCandidate>): ExternalStorageCandidate {
  return {
    id: 'volume-1',
    name: 'USB Drive',
    kind: 'volume',
    sortKey: null,
    volumeClass: null,
    hasDrive: true,
    isNative: true,
    isShadowed: false,
    canMount: false,
    hasMount: true,
    ...overrides,
  };
}

test('selectExternalStorageEntries includes mounted local drive volumes', () => {
  assert.deepEqual(selectExternalStorageEntries([candidate({})]), [
    { id: 'volume-1', name: 'USB Drive', kind: 'volume' },
  ]);
});

test('selectExternalStorageEntries includes unmounted mountable local drive volumes', () => {
  assert.deepEqual(selectExternalStorageEntries([candidate({ hasMount: false, canMount: true })]), [
    { id: 'volume-1', name: 'USB Drive', kind: 'volume' },
  ]);
});

test('selectExternalStorageEntries excludes network volumes and non-native orphan mounts', () => {
  const entries = selectExternalStorageEntries([
    candidate({ id: 'network-volume', volumeClass: 'network' }),
    candidate({
      id: 'sftp-mount',
      name: 'SFTP',
      kind: 'mount',
      hasDrive: false,
      isNative: false,
      hasMount: true,
    }),
  ]);

  assert.deepEqual(entries, []);
});

test('selectExternalStorageEntries excludes unmountable volumes without mounts', () => {
  assert.deepEqual(selectExternalStorageEntries([candidate({ hasMount: false })]), []);
});

test('selectExternalStorageEntries deduplicates stable ids and sorts by sort key', () => {
  const entries = selectExternalStorageEntries([
    candidate({ id: 'b', name: 'Beta', sortKey: '2' }),
    candidate({ id: 'a', name: 'Alpha', sortKey: '1' }),
    candidate({ id: 'a', name: 'Alpha duplicate', sortKey: '1' }),
  ]);

  assert.deepEqual(entries, [
    { id: 'a', name: 'Alpha', kind: 'volume' },
    { id: 'b', name: 'Beta', kind: 'volume' },
  ]);
});
