import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeMarkup, highlightCodeMarkup } from '../../src/clipboard/codeHighlight.ts';

test('escapeMarkup escapes Pango-significant characters', () => {
  assert.equal(escapeMarkup('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d');
});

test('highlights keywords with the keyword color', () => {
  const markup = highlightCodeMarkup('const x = 1;');
  assert.match(markup, /<span foreground="#FFA348" weight="bold">const<\/span>/);
});

test('highlights numbers', () => {
  const markup = highlightCodeMarkup('let n = 42;');
  assert.match(markup, /<span foreground="#7D8AC7">42<\/span>/);
});

test('highlights double and single quoted strings', () => {
  const markup = highlightCodeMarkup('const s = "hello";');
  assert.match(markup, /<span foreground="#5BC8AF">"hello"<\/span>/);
  const single = highlightCodeMarkup("x = 'hi'");
  assert.match(single, /<span foreground="#5BC8AF">'hi'<\/span>/);
});

test('highlights line and block comments', () => {
  const line = highlightCodeMarkup('x = 1 // note');
  assert.match(line, /<span foreground="#777777">\/\/ note<\/span>/);
  const block = highlightCodeMarkup('/* hi */ x');
  assert.match(block, /<span foreground="#777777">\/\* hi \*\/<\/span>/);
});

test('does not tokenize keywords inside strings', () => {
  const markup = highlightCodeMarkup('"const return"');
  assert.match(markup, /<span foreground="#5BC8AF">"const return"<\/span>/);
  assert.doesNotMatch(markup, /weight="bold">const/);
});

test('escapes content inside highlighted tokens', () => {
  const markup = highlightCodeMarkup('"a < b"');
  assert.match(markup, /"a &lt; b"/);
});

test('highlights function calls', () => {
  const markup = highlightCodeMarkup('foo(1)');
  assert.match(markup, /<span foreground="#62A0EA">foo<\/span>/);
});

test('keeps leading whitespace before a # comment outside the span', () => {
  const markup = highlightCodeMarkup('  # comment');
  assert.match(markup, /^ {2}<span foreground="#777777"># comment<\/span>$/);
});

test('produces balanced spans for a multi-line snippet', () => {
  const code = 'function clamp(value, min, max) {\n  if (value < min) return min;\n}';
  const markup = highlightCodeMarkup(code);
  const open = (markup.match(/<span/g) ?? []).length;
  const close = (markup.match(/<\/span>/g) ?? []).length;
  assert.equal(open, close);
  assert.doesNotMatch(markup, /<(?!\/?span)/);
});
