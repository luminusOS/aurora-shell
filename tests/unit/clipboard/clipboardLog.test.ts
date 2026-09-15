import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type ClipboardEntrySnapshot,
  encodeAddOp,
  encodeCompactedLog,
  encodeDeleteOp,
  encodeMoveOp,
  encodePinOp,
  encodeUnpinOp,
  parseClipboardLog,
  removeClipboardEntry,
} from '~/clipboard/clipboardLog.ts';

type ReferenceOp =
  | {
      op: 'add';
      id: string;
      kind?: 'text' | 'image';
      text: string;
      timestamp: number;
      mimeType?: string;
      filePath?: string;
      contentKey?: string;
    }
  | { op: 'delete' | 'move' | 'pin' | 'unpin'; id: string };

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

test('clipboard entries are removed by identity', () => {
  const entries = [alpha, beta];

  removeClipboardEntry(entries, alpha);
  removeClipboardEntry(entries, alpha);

  assert.deepEqual(entries, [beta]);
});

test('clipboard log replay matches array reference for deterministic mixed operations', () => {
  let randomState = 0x5eed1234;
  const random = (limit: number): number => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState % limit;
  };
  const operations: ReferenceOp[] = [];

  for (let index = 0; index < 2_000; index++) {
    const id = String(random(80) + 1);
    const operation = random(10);
    if (operation < 4) {
      operations.push({
        op: 'add',
        id,
        kind: operation === 0 ? 'image' : 'text',
        text: `entry-${index}`,
        timestamp: index,
        mimeType: operation === 0 ? 'image/png' : undefined,
        filePath: operation === 0 ? `/tmp/${index}.png` : undefined,
        contentKey: operation % 2 === 0 ? `key-${index}` : undefined,
      });
    } else {
      const names = ['delete', 'move', 'pin', 'unpin'] as const;
      operations.push({ op: names[random(names.length)], id });
    }
  }

  const validSource = operations.map((operation) => JSON.stringify(operation) + '\n').join('');
  const malformedTail = '{"op":"add"';

  assert.deepEqual(
    parseClipboardLog(validSource + malformedTail),
    parseClipboardLogReference(validSource),
  );
});

test('large clipboard log replay avoids array scans while preserving order', () => {
  const operations: string[] = [];
  const entryCount = 20_000;
  for (let index = 1; index <= entryCount; index++) {
    operations.push(
      JSON.stringify({ op: 'add', id: String(index), text: `entry-${index}`, timestamp: index }),
    );
  }
  for (let index = 1; index <= entryCount; index++) {
    operations.push(JSON.stringify({ op: 'move', id: String(index) }));
  }

  const originalIndexOf = Array.prototype.indexOf;
  let arrayScans = 0;
  Array.prototype.indexOf = function <T>(this: T[], searchElement: T, fromIndex?: number): number {
    arrayScans++;
    return originalIndexOf.call(this, searchElement, fromIndex);
  };

  try {
    const state = parseClipboardLog(operations.join('\n'));

    assert.equal(arrayScans, 0);
    assert.equal(state.history.length, entryCount);
    assert.equal(state.history[0]?.id, String(entryCount));
    assert.equal(state.history.at(-1)?.id, '1');
    assert.equal(state.wastedOps, entryCount);
  } finally {
    Array.prototype.indexOf = originalIndexOf;
  }
});

function parseClipboardLogReference(source: string) {
  const pinned: ClipboardEntrySnapshot[] = [];
  const history: ClipboardEntrySnapshot[] = [];
  const byId = new Map<string, ClipboardEntrySnapshot>();
  let nextId = 1;
  let wastedOps = 0;

  for (const line of source.split('\n')) {
    if (!line) continue;

    let op: ReferenceOp;
    try {
      op = JSON.parse(line) as ReferenceOp;
    } catch {
      break;
    }

    if (op.op === 'add') {
      const entry: ClipboardEntrySnapshot = {
        id: op.id,
        kind: op.kind || 'text',
        text: op.text,
        pinned: false,
        timestamp: op.timestamp,
        contentKey: op.contentKey || op.text,
      };
      if (op.mimeType) entry.mimeType = op.mimeType;
      if (op.filePath) entry.filePath = op.filePath;
      byId.set(entry.id, entry);
      history.unshift(entry);
      nextId = Math.max(nextId, Number.parseInt(entry.id, 10) + 1 || nextId);
      continue;
    }

    const entry = byId.get(op.id);
    if (!entry) continue;

    if (op.op === 'delete') {
      removeClipboardEntry(pinned, entry);
      removeClipboardEntry(history, entry);
      byId.delete(op.id);
      wastedOps += 2;
    } else if (op.op === 'move') {
      const list = entry.pinned ? pinned : history;
      moveReferenceEntryToFront(list, entry);
      wastedOps += 1;
    } else if (op.op === 'pin') {
      removeClipboardEntry(history, entry);
      entry.pinned = true;
      moveReferenceEntryToFront(pinned, entry);
    } else if (op.op === 'unpin') {
      removeClipboardEntry(pinned, entry);
      entry.pinned = false;
      moveReferenceEntryToFront(history, entry);
      wastedOps += 2;
    }
  }

  return { pinned, history, nextId, wastedOps };
}

function moveReferenceEntryToFront(
  list: ClipboardEntrySnapshot[],
  entry: ClipboardEntrySnapshot,
): void {
  removeClipboardEntry(list, entry);
  list.unshift(entry);
}
