// Lightweight, language-agnostic syntax highlighter that emits Pango markup.
//
// This is a pure module with no Shell/GLib imports so it can be unit-tested with
// `node --test`. It is intentionally heuristic: clipboard snippets rarely carry a
// language tag, so a single tokenizer covers the common C-family / scripting
// constructs (comments, strings, numbers, keywords, literals, calls) well enough
// for a preview card. Colors follow the GNOME palette tuned for the dark overview
// surface the clipboard panel renders on.

const COLOR_COMMENT = '#777777';
const COLOR_STRING = '#5BC8AF';
const COLOR_NUMBER = '#7D8AC7';
const COLOR_LITERAL = '#7D8AC7';
const COLOR_KEYWORD = '#FFA348';
const COLOR_FUNCTION = '#62A0EA';

const KEYWORDS = [
  'function',
  'func',
  'fn',
  'def',
  'class',
  'interface',
  'enum',
  'struct',
  'trait',
  'impl',
  'return',
  'if',
  'else',
  'elif',
  'for',
  'foreach',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'import',
  'export',
  'from',
  'as',
  'const',
  'let',
  'var',
  'val',
  'public',
  'private',
  'protected',
  'static',
  'readonly',
  'final',
  'abstract',
  'async',
  'await',
  'yield',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'this',
  'self',
  'super',
  'extends',
  'implements',
  'throw',
  'throws',
  'try',
  'catch',
  'finally',
  'with',
  'void',
  'namespace',
  'module',
  'package',
  'type',
  'using',
  'include',
  'require',
  'lambda',
  'pass',
  'raise',
  'except',
  'global',
  'nonlocal',
  'not',
  'and',
  'or',
  'is',
  'echo',
  'local',
  'then',
  'begin',
  'end',
  'match',
  'when',
  'where',
  'defer',
  'go',
  'select',
  'map',
  'mut',
  'use',
  'mod',
  'pub',
];

type TokenSpec = {
  source: string;
  color: string;
  bold?: boolean;
};

// Order matters: earlier specs win at a given position. Comments and strings come
// first so their contents are not re-tokenized as keywords/numbers.
const SPECS: TokenSpec[] = [
  { source: String.raw`\/\*[\s\S]*?\*\/`, color: COLOR_COMMENT },
  { source: String.raw`\/\/[^\n]*`, color: COLOR_COMMENT },
  { source: String.raw`(?:^|\s)#[^\n]*`, color: COLOR_COMMENT },
  { source: String.raw`"(?:\\.|[^"\\])*"`, color: COLOR_STRING },
  { source: String.raw`'(?:\\.|[^'\\])*'`, color: COLOR_STRING },
  { source: '`(?:\\\\.|[^`\\\\])*`', color: COLOR_STRING },
  { source: String.raw`\b0[xX][0-9a-fA-F]+\b`, color: COLOR_NUMBER },
  { source: String.raw`\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b`, color: COLOR_NUMBER },
  {
    source: String.raw`\b(?:true|false|null|None|True|False|nil|undefined|NaN)\b`,
    color: COLOR_LITERAL,
  },
  { source: String.raw`\b(?:${KEYWORDS.join('|')})\b`, color: COLOR_KEYWORD, bold: true },
  { source: String.raw`[A-Za-z_]\w*(?=\s*\()`, color: COLOR_FUNCTION },
];

const COMBINED = new RegExp(SPECS.map((spec) => `(${spec.source})`).join('|'), 'gm');

export function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrap(text: string, spec: TokenSpec): string {
  const escaped = escapeMarkup(text);
  const weight = spec.bold ? ' weight="bold"' : '';
  return `<span foreground="${spec.color}"${weight}>${escaped}</span>`;
}

/**
 * Highlights a code snippet into Pango markup. All literal text is escaped, so the
 * result is safe to pass to `ClutterText.set_markup`.
 */
export function highlightCodeMarkup(code: string): string {
  let out = '';
  let lastIndex = 0;
  COMBINED.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = COMBINED.exec(code)) !== null) {
    // Guard against zero-length matches stalling the loop.
    if (match.index === COMBINED.lastIndex) {
      COMBINED.lastIndex++;
      continue;
    }

    if (match.index > lastIndex) {
      out += escapeMarkup(code.slice(lastIndex, match.index));
    }

    // match[i] (1-based) corresponds to SPECS[i - 1].
    let specIndex = -1;
    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        specIndex = i - 1;
        break;
      }
    }

    const token = match[0];
    if (specIndex === -1) {
      out += escapeMarkup(token);
    } else {
      // The leading-comment spec may absorb a leading whitespace char; keep it
      // outside the colored span so indentation stays neutral.
      const spec = SPECS[specIndex]!;
      const leadingWs = /^\s/.test(token) && token[1] === '#' ? token[0]! : '';
      out += escapeMarkup(leadingWs) + wrap(token.slice(leadingWs.length), spec);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < code.length) {
    out += escapeMarkup(code.slice(lastIndex));
  }

  return out;
}
