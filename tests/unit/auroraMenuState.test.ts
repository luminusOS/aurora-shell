import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decodeXml,
  parseCustomCommand,
  serializeCustomCommand,
  truncateMiddle,
} from '../../src/panel/auroraMenuState.ts';

test('Aurora Menu state — parses label and command around the first separator', () => {
  assert.deepEqual(parseCustomCommand('Terminal | foot --working-directory=/tmp|logs'), {
    label: 'Terminal',
    command: 'foot --working-directory=/tmp|logs',
  });
  assert.equal(parseCustomCommand('missing separator'), null);
  assert.equal(parseCustomCommand(' | missing label'), null);
  assert.equal(parseCustomCommand('missing command | '), null);
});

test('Aurora Menu state — serializes custom commands in the settings format', () => {
  assert.equal(
    serializeCustomCommand({ label: '  Terminal  ', command: '  ptyxis --new-window  ' }),
    'Terminal | ptyxis --new-window',
  );
});

test('Aurora Menu state — decodes XML entities in recent item labels', () => {
  assert.equal(decodeXml('A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;'), 'A & B <C> "D" \'E\'');
});

test('Aurora Menu state — truncates the middle while preserving both edges', () => {
  assert.equal(truncateMiddle('abcdefghij', 7), 'abc…hij');
  assert.equal(truncateMiddle('short', 7), 'short');
});
