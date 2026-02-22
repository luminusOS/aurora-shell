import type { Plugin } from 'esbuild';
import { readFileSync } from 'node:fs';

// Transform @GObject.registerClass decorators into GObject.registerClass() calls.
// This lets source files use the cleaner decorator syntax while emitting the
// GObject.registerClass(metadata, class ...) form that GJS requires at runtime.
export const gobjectDecorator: Plugin = {
  name: 'gobject-decorator',
  setup(ctx) {
    ctx.onLoad({ filter: /\.ts$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes('@GObject.registerClass')) return undefined;
      return { contents: transformGObjectDecorators(source), loader: 'ts' };
    });
  },
};

function transformGObjectDecorators(source: string): string {
  const DECORATOR = '@GObject.registerClass';
  let result = source;
  let searchFrom = 0;

  while (true) {
    const decoratorIdx = result.indexOf(DECORATOR, searchFrom);
    if (decoratorIdx === -1) break;

    const replaceStart = decoratorIdx;
    let pos = decoratorIdx + DECORATOR.length;
    while (pos < result.length && /\s/.test(result[pos])) pos++;

    let metadata = '';
    if (result[pos] === '(') {
      const closePos = findMatchingClose(result, pos);
      metadata = result.substring(pos + 1, closePos - 1).trim();
      pos = closePos;
      while (pos < result.length && /\s/.test(result[pos])) pos++;
    }

    let hasExport = false;
    if (result.substring(pos).startsWith('export')) {
      hasExport = true;
      pos += 'export'.length;
      while (pos < result.length && /\s/.test(result[pos])) pos++;
    }

    if (!result.substring(pos).startsWith('class ')) {
      searchFrom = pos;
      continue;
    }

    const classStart = pos;
    const nameMatch = result.substring(pos).match(/^class\s+(\w+)/);
    if (!nameMatch) { searchFrom = pos; continue; }
    const className = nameMatch[1];

    while (pos < result.length && result[pos] !== '{') pos++;
    const classEnd = findMatchingClose(result, pos);
    const classDecl = result.substring(classStart, classEnd);

    const prefix = hasExport ? 'export ' : '';
    const replacement = metadata
      ? `${prefix}const ${className} = GObject.registerClass(${metadata}, ${classDecl});`
      : `${prefix}const ${className} = GObject.registerClass(${classDecl});`;

    result = result.substring(0, replaceStart) + replacement + result.substring(classEnd);
    searchFrom = replaceStart + replacement.length;
  }

  return result;
}

function findMatchingClose(source: string, start: number): number {
  const open = source[start];
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  let depth = 1;
  let pos = start + 1;

  while (pos < source.length && depth > 0) {
    const ch = source[pos];

    if (ch === '"' || ch === "'" || ch === '`') {
      pos++;
      while (pos < source.length && source[pos] !== ch) {
        if (source[pos] === '\\') pos++;
        pos++;
      }
      pos++;
      continue;
    }

    if (ch === '/' && pos + 1 < source.length && source[pos + 1] === '/') {
      pos = source.indexOf('\n', pos);
      if (pos === -1) return source.length;
      pos++;
      continue;
    }

    if (ch === '/' && pos + 1 < source.length && source[pos + 1] === '*') {
      pos = source.indexOf('*/', pos + 2);
      if (pos === -1) return source.length;
      pos += 2;
      continue;
    }

    if (ch === open) depth++;
    else if (ch === close) depth--;
    pos++;
  }

  return pos;
}
