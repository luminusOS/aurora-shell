import assert from 'node:assert/strict';
import test from 'node:test';

import { extractHttpUrls } from '../../../src/shared/httpUrlExtractor.internal.js';

test('HTTP URL extractor restores whitespace inside angle brackets', () => {
  const urls = extractHttpUrls(
    ['Reference: <https://video.example.org/room/', 'alpha?token=example&', 'mode=guest>'].join(
      '\n',
    ),
  );

  assert.deepStrictEqual(urls, ['https://video.example.org/room/alpha?token=example&mode=guest']);
});

test('HTTP URL extractor restores structurally continued bare URLs', () => {
  const urls = extractHttpUrls(
    ['Join https://video.example.org/rooms/12345678', '901?', 'token=example&', 'mode=guest'].join(
      '\n',
    ),
  );

  assert.deepStrictEqual(urls, [
    'https://video.example.org/rooms/12345678901?token=example&mode=guest',
  ]);
});

test('HTTP URL extractor restores a path segment isolated by hard wrapping', () => {
  const urls = extractHttpUrls(['Join https://video.example.org/rooms/', 'alpha'].join('\n'));

  assert.deepStrictEqual(urls, ['https://video.example.org/rooms/alpha']);
});

test('HTTP URL extractor restores generic queries with whitespace around operators', () => {
  const urls = extractHttpUrls(
    ['https://video.example.org/room?', 'token', '= example'].join('\n'),
  );

  assert.deepStrictEqual(urls, ['https://video.example.org/room?token=example']);
});

test('HTTP URL extractor restores a query value isolated after an equals sign', () => {
  const urls = extractHttpUrls(
    ['https://video.example.org/room?token=', 'ExamplePasscode'].join('\n'),
  );

  assert.deepStrictEqual(urls, ['https://video.example.org/room?token=ExamplePasscode']);
});

test('HTTP URL extractor restores paths, queries and percent escapes generically', () => {
  const urls = extractHttpUrls(
    [
      'https://例え.example/session-',
      'part?return=https%3A%',
      '2F%2Fexample.org&',
      'lang=pt-BR',
    ].join('\n'),
  );

  assert.deepStrictEqual(urls, [
    'https://例え.example/session-part?return=https%3A%2F%2Fexample.org&lang=pt-BR',
  ]);
});

test('HTTP URL extractor does not absorb unrelated following lines', () => {
  const urls = extractHttpUrls(
    [
      'Join https://video.example.org/room/alpha',
      'Meeting ID: 123 456',
      'Docs https://docs.example.org/guide.',
    ].join('\n'),
  );

  assert.deepStrictEqual(urls, [
    'https://video.example.org/room/alpha',
    'https://docs.example.org/guide',
  ]);
});

test('HTTP URL extractor treats sentence punctuation as a boundary across lines', () => {
  const urls = extractHttpUrls(['See https://example.org/docs.', 'Next paragraph'].join('\n'));

  assert.deepStrictEqual(urls, ['https://example.org/docs']);
});

test('HTTP URL extractor does not append prose after an open-looking URL suffix', () => {
  const urls = extractHttpUrls(
    [
      'Join https://calls.example.org/',
      'Meeting ID: 123',
      'Calendar https://calendar.example.org/event/123',
      '2026 agenda',
      'Token https://calls.example.org/room?token=',
      'Meeting ID: 456',
    ].join('\n'),
  );

  assert.deepStrictEqual(urls, [
    'https://calls.example.org/',
    'https://calendar.example.org/event/123',
    'https://calls.example.org/room?token=',
  ]);
});

test('HTTP URL extractor preserves balanced punctuation and trims prose punctuation', () => {
  const urls = extractHttpUrls('See https://example.org/wiki/Meeting_(software)), then continue.');

  assert.deepStrictEqual(urls, ['https://example.org/wiki/Meeting_(software)']);
});

test('HTTP URL extractor rejects credentials and malformed authorities', () => {
  const urls = extractHttpUrls(
    [
      'https://user@example.org/secret',
      'https://-invalid.example/path',
      'https://[not-ipv6]/path',
      'https://valid.example:443/path',
    ].join(' '),
  );

  assert.deepStrictEqual(urls, ['https://valid.example:443/path']);
});
