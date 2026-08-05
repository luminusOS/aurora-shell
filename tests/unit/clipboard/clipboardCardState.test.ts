import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyClipboardCard,
  parseClipboardUrl,
  truncateClipboardText,
} from '~/clipboard/clipboardCardState.ts';

test('clipboard cards classify images, links, code and plain text', () => {
  assert.equal(classifyClipboardCard('image', ''), 'image');
  assert.equal(classifyClipboardCard('text', 'https://example.com/path?q=1'), 'link');
  assert.equal(classifyClipboardCard('text', 'const value = 1;\nreturn value;'), 'code');
  assert.equal(classifyClipboardCard('text', 'a normal sentence'), 'text');
});

test('clipboard URL parsing strips query from display path and rejects whitespace', () => {
  assert.deepEqual(parseClipboardUrl('https://example.com/docs?q=1'), {
    host: 'example.com',
    path: '/docs',
  });
  assert.equal(parseClipboardUrl('https://example.com/a b'), null);
});

test('clipboard truncation adds an ellipsis only beyond the limit', () => {
  assert.equal(truncateClipboardText('abcd', 4), 'abcd');
  assert.equal(truncateClipboardText('abcde', 4), 'abcd…');
});
