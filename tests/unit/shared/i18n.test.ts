import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = resolve(root, 'src');

function typeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('i18n — all translated source uses the Aurora gettext domain', () => {
  for (const path of typeScriptFiles(sourceRoot)) {
    if (path.endsWith('/shared/i18n.ts')) continue;
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      source,
      /from ['"]gettext['"]/,
      `${relative(root, path)} imports the process-wide gettext domain`,
    );
    assert.doesNotMatch(
      source,
      /gettext as _.*@girs\/gnome-shell\/extensions/,
      `${relative(root, path)} bypasses the shared Aurora gettext domain`,
    );
  }
});

test('i18n — shared gettext domain matches metadata', () => {
  const metadata = JSON.parse(readFileSync(resolve(root, 'metadata.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const source = readFileSync(resolve(sourceRoot, 'shared/i18n.ts'), 'utf8');
  assert.match(source, new RegExp(`GETTEXT_DOMAIN = '${metadata['gettext-domain']}'`));
});
