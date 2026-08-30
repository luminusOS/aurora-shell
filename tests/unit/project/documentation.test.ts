import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const publicMarkdown = [
  resolve(root, 'README.md'),
  resolve(root, 'CONTRIBUTING.md'),
  ...readdirSync(resolve(root, 'docs'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === '.md')
    .map((entry) => resolve(root, 'docs', entry.name)),
];

function anchors(markdown: string): Set<string> {
  const result = new Set<string>();
  const duplicates = new Map<string, number>();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gmu)) {
    const base = match[1]!
      .toLowerCase()
      .replace(/<[^>]+>/gu, '')
      .replace(/[`*_~]/gu, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/gu, '-');
    const count = duplicates.get(base) || 0;
    duplicates.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${count}`);
  }
  return result;
}

function localLinks(markdown: string): string[] {
  const links = [...markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)].map(
    (match) => match[1]!,
  );
  for (const match of markdown.matchAll(/<(?:a|img)\s+[^>]*(?:href|src)="([^"]+)"/giu))
    links.push(match[1]!);
  return links.filter(
    (link) => !/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(link) && !link.startsWith('data:'),
  );
}

function catalogKeys(): string[] {
  const catalogPath = resolve(root, 'src/moduleCatalog.ts');
  const source = ts.createSourceFile(
    catalogPath,
    readFileSync(catalogPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const paths = new Map<string, string>();
  let order: string[] = [];

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          if (element.propertyName?.text === 'manifest')
            paths.set(element.name.text, statement.moduleSpecifier.text.replace(/^~\//u, 'src/'));
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText() !== 'MODULE_CATALOG') continue;
      assert.ok(declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer));
      order = declaration.initializer.elements.map((element) => {
        assert.ok(ts.isIdentifier(element));
        return element.text;
      });
    }
  }

  return order.map((alias) => {
    const path = paths.get(alias);
    assert.ok(path, `catalog alias ${alias} has no manifest import`);
    const match = readFileSync(resolve(root, path), 'utf8').match(/\bkey:\s*'([^']+)'/u);
    assert.ok(match, `${path} has no literal module key`);
    return match[1]!;
  });
}

test('documentation: local links and anchors resolve', () => {
  for (const source of publicMarkdown) {
    const markdown = readFileSync(source, 'utf8');
    for (const link of localLinks(markdown)) {
      const [rawPath, rawAnchor] = link.split('#', 2);
      const target = rawPath ? resolve(dirname(source), decodeURIComponent(rawPath)) : source;
      assert.ok(existsSync(target), `${source}: missing link target ${link}`);
      if (!rawAnchor || extname(target) !== '.md') continue;
      assert.ok(
        anchors(readFileSync(target, 'utf8')).has(decodeURIComponent(rawAnchor).toLowerCase()),
        `${source}: missing anchor ${link}`,
      );
    }
  }
});

test('documentation: module reference exactly matches MODULE_CATALOG', () => {
  const reference = readFileSync(resolve(root, 'docs/module-reference.md'), 'utf8');
  const documented = [...reference.matchAll(/^\|\s+`([^`]+)`\s+\|/gmu)].map((match) => match[1]!);
  assert.deepEqual(documented, catalogKeys());
  assert.equal(
    documented.length,
    new Set(documented).size,
    'documented module keys must be unique',
  );
});

test('documentation: documented just commands resolve to recipes', () => {
  const just = (process.env.PATH || '')
    .split(':')
    .map((directory) => resolve(directory, 'just'))
    .find(existsSync);
  assert.ok(just, 'just is not installed');
  const commands = new Set<string>();
  for (const file of publicMarkdown) {
    const markdown = readFileSync(file, 'utf8');
    for (const block of markdown.matchAll(/```bash\n([\s\S]*?)```/gu))
      for (const line of block[1]!.split('\n')) {
        const command = line.match(/(?:^|\s)just(?:\s+.*)?$/u)?.[0]?.trim();
        if (command) commands.add(command);
      }
    for (const match of markdown.matchAll(/`(just(?:\s+[^`]+)?)`/gu)) commands.add(match[1]!);
  }

  for (const command of commands) {
    const args = command.split(/\s+/u).slice(1);
    assert.doesNotThrow(
      () => execFileSync(just, ['--dry-run', ...args], { cwd: root, stdio: 'pipe' }),
      command,
    );
  }
});
