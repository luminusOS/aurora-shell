import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWebSearchUri,
  chooseOcrLanguages,
  parseLanguageOverride,
  parseTesseractLanguages,
  parseTesseractTsv,
  placeOcrActionBelow,
} from '../../src/capture/ocrLogic.ts';

test('OCR web search URI supports configured providers and defaults to DuckDuckGo', () => {
  const text = '  Aurora OCR\ntexto & símbolos  ';
  const query = 'Aurora%20OCR%0Atexto%20%26%20s%C3%ADmbolos';
  assert.equal(buildWebSearchUri(text), `https://duckduckgo.com/?q=${query}`);
  assert.equal(buildWebSearchUri(text, 'duckduckgo'), `https://duckduckgo.com/?q=${query}`);
  assert.equal(buildWebSearchUri(text, 'google'), `https://www.google.com/search?q=${query}`);
  assert.equal(buildWebSearchUri(text, 'bing'), `https://www.bing.com/search?q=${query}`);
  assert.equal(buildWebSearchUri(text, 'invalid'), `https://duckduckgo.com/?q=${query}`);
});

test('OCR languages use a valid override or locale plus English', () => {
  assert.deepEqual(parseLanguageOverride('por+eng, spa invalid-code'), ['por', 'eng', 'spa']);
  assert.deepEqual(chooseOcrLanguages('deu+missing', ['pt_BR.UTF-8'], ['eng', 'por', 'deu']), [
    'deu',
  ]);
  assert.deepEqual(chooseOcrLanguages('', ['pt_BR.UTF-8'], ['eng', 'por']), ['por', 'eng']);
  assert.deepEqual(chooseOcrLanguages('', ['xx_YY'], ['fra']), ['fra']);
});

test('Tesseract language listing ignores its heading and malformed codes', () => {
  assert.deepEqual(
    parseTesseractLanguages(
      'List of available languages in /usr/share/tessdata (3):\npor\neng\nbad-code\n',
    ),
    ['eng', 'por'],
  );
});

test('TSV parsing maps OCR pixels to stage coordinates and groups lines', () => {
  const header =
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const rows = [
    '5\t1\t1\t1\t1\t1\t20\t10\t40\t20\t95\tHello',
    '5\t1\t1\t1\t1\t2\t70\t10\t30\t20\t90\tworld',
    '5\t1\t1\t1\t2\t1\t20\t40\t50\t20\t88\tAgain',
    '4\t1\t1\t1\t2\t0\t0\t0\t0\t0\t-1\t',
    'malformed',
  ];
  const result = parseTesseractTsv([header, ...rows].join('\n'), 2, { x: 100, y: 50 });
  assert.equal(result.text, 'Hello world\nAgain');
  assert.equal(result.words.length, 3);
  assert.deepEqual(result.words[0]?.bounds, { x: 110, y: 55, width: 20, height: 10 });
});

test('TSV parsing rejects invalid scale', () => {
  assert.deepEqual(parseTesseractTsv('header', 0, { x: 0, y: 0 }), { words: [], text: '' });
});

test('OCR copy action is centered below the selection and stays on screen', () => {
  assert.deepEqual(
    placeOcrActionBelow(
      { x: 100, y: 80, width: 200, height: 100 },
      { width: 40, height: 40 },
      { width: 500, height: 400 },
    ),
    { x: 180, y: 192 },
  );
  assert.deepEqual(
    placeOcrActionBelow(
      { x: -20, y: 340, width: 80, height: 40 },
      { width: 40, height: 40 },
      { width: 500, height: 400 },
    ),
    { x: 12, y: 288 },
  );
});
