import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const schemaId = 'org.gnome.shell.extensions.aurora-shell';
const schemaFile = resolve(
  root,
  'data/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml',
);

function catalogSettingsKeys(): string[] {
  const catalogPath = resolve(root, 'src/moduleCatalog.ts');
  const catalog = ts.createSourceFile(
    catalogPath,
    readFileSync(catalogPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const manifestPaths: string[] = [];
  for (const statement of catalog.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.propertyName?.text === 'manifest')
    )
      manifestPaths.push(statement.moduleSpecifier.text.replace(/^~\//, 'src/'));
  }

  return manifestPaths.flatMap((path) => {
    const absolute = resolve(root, path);
    const source = ts.createSourceFile(
      absolute,
      readFileSync(absolute, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const keys: string[] = [];
    let manifestObject: ts.ObjectLiteralExpression | undefined;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          declaration.name.getText() === 'manifest' &&
          ts.isObjectLiteralExpression(declaration.initializer)
        )
          manifestObject = declaration.initializer;
      }
    }
    assert.ok(manifestObject, `${path} has no manifest object`);
    function visit(node: ts.Node): void {
      if (
        ts.isPropertyAssignment(node) &&
        ['settingsKey', 'hourKey', 'minuteKey'].includes(node.name.getText()) &&
        ts.isStringLiteral(node.initializer)
      )
        keys.push(node.initializer.text);
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === 'key' &&
        node.parent !== manifestObject &&
        ts.isStringLiteral(node.initializer)
      )
        keys.push(node.initializer.text);
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === 'internalSettings' &&
        ts.isArrayLiteralExpression(node.initializer)
      )
        for (const element of node.initializer.elements) {
          assert.ok(ts.isStringLiteral(element), `${path} internal settings must be literals`);
          keys.push(element.text);
        }
      ts.forEachChild(node, visit);
    }
    visit(manifestObject);
    assert.ok(keys.length > 0, `${path} has no literal settings keys`);
    return keys;
  });
}

function compiledSchemaKeys(): string[] {
  const schema = readFileSync(schemaFile, 'utf8').match(
    new RegExp(`<schema\\s+[^>]*id="${schemaId}"[^>]*>([\\s\\S]*?)</schema>`, 'u'),
  );
  assert.ok(schema, `schema ${schemaId} is missing`);
  return [...schema[1]!.matchAll(/<key\s+[^>]*name="([^"]+)"/gu)].map((match) => match[1]!);
}

function schemaDefault(key: string): string {
  const xml = readFileSync(schemaFile, 'utf8');
  const keyMarker = `name="${key}"`;
  const keyMarkerIndex = xml.indexOf(keyMarker);
  assert.notEqual(keyMarkerIndex, -1, `schema key ${key} is missing`);

  const keyStart = xml.lastIndexOf('<key ', keyMarkerIndex);
  const keyEnd = xml.indexOf('</key>', keyMarkerIndex);
  assert.ok(keyStart >= 0 && keyEnd > keyStart, `invalid schema key element for ${key}`);

  const defaultStartTag = '<default>';
  const defaultStart = xml.indexOf(defaultStartTag, keyStart);
  const defaultEnd = xml.indexOf('</default>', defaultStart);
  assert.ok(
    defaultStart > keyStart && defaultEnd > defaultStart && defaultEnd < keyEnd,
    `schema key ${key} has no default`,
  );
  return xml.slice(defaultStart + defaultStartTag.length, defaultEnd).trim();
}

test('schema: is structurally valid', () => {
  execFileSync('glib-compile-schemas', ['--strict', '--dry-run', dirname(schemaFile)]);
});

test('schema: contains every catalog module key', () => {
  const schemaKeys = new Set(compiledSchemaKeys());
  const moduleKeys = catalogSettingsKeys();
  for (const key of moduleKeys) assert.ok(schemaKeys.has(key), key);
  assert.equal(moduleKeys.length, new Set(moduleKeys).size);
});

test('schema: has no module switches absent from the catalog', () => {
  const moduleKeys = new Set(catalogSettingsKeys().filter((key) => key.startsWith('module-')));
  const schemaModuleKeys = compiledSchemaKeys().filter((key) => key.startsWith('module-'));
  assert.deepEqual([...schemaModuleKeys].sort(), [...moduleKeys].sort());
});

test('schema ↔ catalog: every declared module and option setting is synchronized', () => {
  assert.deepEqual([...compiledSchemaKeys()].sort(), [...catalogSettingsKeys()].sort());
});

test('schema: Vela VPN integration and Shell fallback are disabled by default', () => {
  assert.equal(schemaDefault('module-vela-vpn-quick-settings'), 'false');
  assert.equal(schemaDefault('vela-vpn-quick-settings-shell-fallback'), 'false');
});

test('schema: Clipboard History automatic paste is enabled by default', () => {
  assert.equal(schemaDefault('clipboard-history-auto-paste'), 'true');
});

test('schema: Capture Tools uses DuckDuckGo by default', () => {
  assert.equal(schemaDefault('capture-tools-web-search-engine'), "'duckduckgo'");
});

test('schema: Dock defaults to the primary monitor only', () => {
  assert.equal(schemaDefault('dock-show-on-all-monitors'), 'false');
});

test('schema: Dock preserves the GNOME default maximum icon size', () => {
  assert.equal(schemaDefault('dock-icon-size'), '64');
});

test('schema: Dock uses always auto-hide by default', () => {
  assert.equal(schemaDefault('dock-intellihide'), 'false');
});

test('schema: Dock window previews are opt-in by default', () => {
  assert.equal(schemaDefault('dock-window-previews'), 'false');
});

test('schema: Volume Mixer button is contextual by default', () => {
  assert.equal(schemaDefault('volume-mixer-always-show'), 'false');
});
