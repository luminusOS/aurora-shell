import assert from 'node:assert/strict';
import test from 'node:test';

import {
  encodeAddOp,
  encodeCompactedLog,
  encodeDeleteOp,
  encodeMoveOp,
  encodePinOp,
  encodeUnpinOp,
  parseClipboardLog,
} from '../../src/clipboard/clipboardLog.ts';

const alpha = {
  id: '1',
  kind: 'text' as const,
  text: 'alpha',
  pinned: false,
  timestamp: 1,
  contentKey: 'text:alpha',
};
const beta = {
  id: '2',
  kind: 'text' as const,
  text: 'beta',
  pinned: false,
  timestamp: 2,
  contentKey: 'text:beta',
};
const gamma = {
  id: '3',
  kind: 'text' as const,
  text: 'gamma',
  pinned: false,
  timestamp: 3,
  contentKey: 'text:gamma',
};
const image = {
  id: '4',
  kind: 'image' as const,
  text: 'Image',
  pinned: false,
  timestamp: 4,
  mimeType: 'image/png',
  filePath: '/tmp/aurora-clipboard-test.png',
  contentKey: 'image:image/png:4-deadbeef',
};

test('clipboard log parses append-only add operations newest first', () => {
  const state = parseClipboardLog(encodeAddOp(alpha) + encodeAddOp(beta));

  assert.deepEqual(
    state.history.map((entry) => entry.text),
    ['beta', 'alpha'],
  );
  assert.equal(state.nextId, 3);
});

test('clipboard log applies move, pin, unpin and delete operations', () => {
  const state = parseClipboardLog(
    encodeAddOp(alpha) +
      encodeAddOp(beta) +
      encodeAddOp(gamma) +
      encodeMoveOp(alpha.id) +
      encodePinOp(beta.id) +
      encodeUnpinOp(beta.id) +
      encodeDeleteOp(gamma.id),
  );

  assert.deepEqual(
    state.history.map((entry) => entry.text),
    ['beta', 'alpha'],
  );
  assert.deepEqual(state.pinned, []);
  assert.equal(state.wastedOps, 5);
});

test('clipboard log compaction preserves current order and pinned state', () => {
  const compacted = encodeCompactedLog([
    { ...beta, pinned: false },
    { ...alpha, pinned: true },
  ]);
  const state = parseClipboardLog(compacted);

  assert.deepEqual(
    state.history.map((entry) => entry.text),
    ['beta'],
  );
  assert.deepEqual(
    state.pinned.map((entry) => entry.text),
    ['alpha'],
  );
  assert.equal(state.wastedOps, 0);
});

test('clipboard log preserves image metadata', () => {
  const state = parseClipboardLog(encodeAddOp(image));

  assert.equal(state.history[0]?.kind, 'image');
  assert.equal(state.history[0]?.mimeType, 'image/png');
  assert.equal(state.history[0]?.filePath, '/tmp/aurora-clipboard-test.png');
  assert.equal(state.history[0]?.contentKey, 'image:image/png:4-deadbeef');
});
