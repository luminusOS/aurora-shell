import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = resolve('src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.scss') ? [path] : [];
  });
}

test('source lines stay within the EGO 200-character limit', () => {
  const violations: string[] = [];
  for (const file of sourceFiles(sourceRoot)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (line.length > 200)
        violations.push(`${file.slice(sourceRoot.length + 1)}:${index + 1} (${line.length})`);
    }
  }
  assert.deepEqual(violations, []);
});

test('widgets override destroy instead of observing their own destroy signal', () => {
  const violations: string[] = [];
  for (const file of sourceFiles(sourceRoot).filter((path) => path.endsWith('.ts'))) {
    const source = readFileSync(file, 'utf8');
    if (/\bthis\.connect\(\s*['"]destroy['"]/u.test(source))
      violations.push(file.slice(sourceRoot.length + 1));
  }
  assert.deepEqual(violations, []);
});

test('module enable and disable methods remain adjacent', () => {
  const violations: string[] = [];
  for (const file of sourceFiles(sourceRoot).filter((path) => path.endsWith('.ts'))) {
    const source = readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isClassDeclaration(node) &&
        node.heritageClauses?.some((clause) =>
          clause.types.some((type) => type.expression.getText(tree) === 'Module'),
        )
      ) {
        const methods = node.members
          .filter(ts.isMethodDeclaration)
          .map((method) => method.name.getText(tree));
        const enableIndex = methods.indexOf('enable');
        const disableIndex = methods.indexOf('disable');
        if (enableIndex >= 0 && disableIndex !== enableIndex + 1)
          violations.push(file.slice(sourceRoot.length + 1));
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  assert.deepEqual(violations, []);
});

test('new lifecycle flags are not used as resource ownership', () => {
  const violations: string[] = [];
  const forbiddenDeclaration =
    /\b(?:private|protected|public|declare\s+private)\s+_(?:enabled|destroyed|disposed|running|uiAlive)\b/u;
  for (const file of sourceFiles(sourceRoot).filter((path) => path.endsWith('.ts'))) {
    if (file.endsWith(join('shared', 'ui', 'dash.ts'))) continue;
    if (forbiddenDeclaration.test(readFileSync(file, 'utf8')))
      violations.push(file.slice(sourceRoot.length + 1));
  }
  assert.deepEqual(violations, []);
});
