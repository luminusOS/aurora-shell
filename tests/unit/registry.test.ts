import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type CatalogEntry = {
  key: string;
  settingsKey: string;
  section: string;
  runtimeRoles: string[];
};

function sourceFile(relativePath: string): ts.SourceFile {
  const path = resolve(root, relativePath);
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const item of object.properties) {
    if (!ts.isPropertyAssignment(item)) continue;
    const itemName =
      ts.isIdentifier(item.name) || ts.isStringLiteral(item.name) ? item.name.text : '';
    if (itemName === name) return item.initializer;
  }
  return undefined;
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string {
  const value = property(object, name);
  assert.ok(value && ts.isStringLiteral(value), `${name} must be a string literal`);
  return value.text;
}

function catalog(): CatalogEntry[] {
  const catalogSource = sourceFile('src/moduleCatalog.ts');
  const imports = new Map<string, string>();
  for (const statement of catalogSource.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.propertyName?.text === 'manifest')
        imports.set(element.name.text, element.name.text);
    }
  }

  const paths = new Map<string, string>();
  for (const statement of catalogSource.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.propertyName?.text === 'manifest')
        paths.set(element.name.text, statement.moduleSpecifier.text.replace(/^~\//, 'src/'));
    }
  }

  let order: string[] = [];
  for (const statement of catalogSource.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText() !== 'MODULE_CATALOG') continue;
      assert.ok(declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer));
      order = declaration.initializer.elements.map((element) => {
        assert.ok(
          ts.isIdentifier(element),
          'catalog entries must be imported manifest identifiers',
        );
        return element.text;
      });
    }
  }

  return order.map((alias) => {
    const manifestPath = paths.get(alias);
    assert.ok(manifestPath && imports.has(alias), `catalog alias ${alias} has no manifest import`);
    const manifestSource = sourceFile(manifestPath);
    let object: ts.ObjectLiteralExpression | undefined;
    for (const statement of manifestSource.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          declaration.name.getText() === 'manifest' &&
          ts.isObjectLiteralExpression(declaration.initializer)
        )
          object = declaration.initializer;
      }
    }
    assert.ok(object, `${manifestPath} must export a manifest object`);
    const runtime = property(object, 'runtime');
    const roles =
      runtime && ts.isObjectLiteralExpression(runtime) ? property(runtime, 'roles') : undefined;
    return {
      key: stringProperty(object, 'key'),
      settingsKey: stringProperty(object, 'settingsKey'),
      section: stringProperty(object, 'section'),
      runtimeRoles:
        roles && ts.isArrayLiteralExpression(roles)
          ? roles.elements.map((role) => {
              assert.ok(ts.isStringLiteral(role));
              return role.text;
            })
          : [],
    };
  });
}

function factoryKeys(): string[] {
  const registry = sourceFile('src/registry.ts');
  for (const statement of registry.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText() !== 'factories') continue;
      const expression = ts.isSatisfiesExpression(declaration.initializer)
        ? declaration.initializer.expression
        : declaration.initializer;
      assert.ok(ts.isObjectLiteralExpression(expression));
      return expression.properties.map((item) => {
        assert.ok(ts.isPropertyAssignment(item));
        assert.ok(ts.isIdentifier(item.name) || ts.isStringLiteral(item.name));
        return item.name.text;
      });
    }
  }
  throw new Error('registry factories object not found');
}

const entries = catalog();
const keys = entries.map((entry) => entry.key);
const settingsKeys = entries.map((entry) => entry.settingsKey);

test('catalog — ids and settings keys are unique', () => {
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(settingsKeys).size, settingsKeys.length);
});

test('catalog ↔ registry — every manifest has exactly one factory', () => {
  assert.deepEqual([...factoryKeys()].sort(), [...keys].sort());
});

test('catalog — every section is declared by moduleCatalog', () => {
  const catalogSource = sourceFile('src/moduleCatalog.ts');
  const sections = new Set<string>();
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'id' &&
      ts.isStringLiteral(node.initializer)
    )
      sections.add(node.initializer.text);
    ts.forEachChild(node, visit);
  }
  visit(catalogSource);
  for (const entry of entries) assert.ok(sections.has(entry.section), entry.key);
});

test('prefs uses the manifest-only catalog and extension uses the runtime registry', () => {
  const prefs = sourceFile('src/prefs.ts');
  const importsCatalog = prefs.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '~/moduleCatalog.ts',
  );
  assert.equal(importsCatalog, true);
  const extension = sourceFile('src/extension.ts');
  const importsRegistry = extension.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '~/registry.ts',
  );
  assert.equal(importsRegistry, true);
});

test('moduleCatalog — does not import runtime module implementations', () => {
  const catalogSource = sourceFile('src/moduleCatalog.ts');
  for (const statement of catalogSource.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    if (statement.importClause?.isTypeOnly) continue;
    const path = statement.moduleSpecifier.text;
    assert.ok(
      path === '~/shared/i18n.ts' || path.endsWith('.manifest.ts'),
      `runtime import ${path} is not allowed in moduleCatalog`,
    );
  }
});

test('catalog — desktop module baseline is preserved', () => {
  assert.deepEqual(keys, [
    'no-overview',
    'pip-on-top',
    'focus-launched-windows',
    'capture-tools',
    'theme-changer',
    'dock',
    'aurora-menu',
    'volume-mixer',
    'low-battery-percentage',
    'lock-key-indicators',
    'xwayland-indicator',
    'privacy',
    'icon-weave',
    'app-search-tooltip',
    'vela-vpn-quick-settings',
    'auto-theme-switcher',
    'bluetooth-menu',
    'weather-clock',
    'meeting-clock',
    'tray-icons',
    'clipboard-history',
  ]);
});

test('catalog — shared is not a device/display role', () => {
  for (const entry of entries) assert.ok(!entry.runtimeRoles.includes('shared'), entry.key);
});
