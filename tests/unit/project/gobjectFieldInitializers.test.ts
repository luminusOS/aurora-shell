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
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function memberName(member: ts.ClassElement): string | null {
  const name = member.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  return null;
}

function hasDeclareModifier(member: ts.ClassElement): boolean {
  return Boolean(
    ts.canHaveModifiers(member) &&
    ts.getModifiers(member)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword),
  );
}

/**
 * Finds direct `this.<name> = ...` assignments and `this.<name>()` calls in a
 * method body. Nested functions run later and are excluded from construction.
 */
function scanBody(body: ts.Node): { assigned: Set<string>; called: Set<string> } {
  const assigned = new Set<string>();
  const called = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== body) return;

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      assigned.add(node.left.name.text);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      called.add(node.expression.name.text);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);
  return { assigned, called };
}

/**
 * GJS calls `_init` inside `super()`. Class field initializers run afterward
 * and can overwrite values stored by `_init` or the methods it calls. Fields
 * written during construction must use `declare`, which emits no initializer.
 *
 * The failure is silent: a separator created during `_init` was orphaned, and
 * the next sync added a duplicate.
 */
test('GObject classes do not shadow `_init` assignments with field initializers', () => {
  const violations: string[] = [];

  for (const file of sourceFiles(sourceRoot)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
    );

    const visitClass = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const methods = new Map<string, ts.Node>();
        const initialized = new Map<string, number>();

        for (const member of node.members) {
          const name = memberName(member);
          if (!name) continue;
          if (ts.isMethodDeclaration(member) && member.body) methods.set(name, member.body);
          if (
            ts.isPropertyDeclaration(member) &&
            member.initializer &&
            !hasDeclareModifier(member)
          ) {
            initialized.set(
              name,
              source.getLineAndCharacterOfPosition(member.getStart(source)).line + 1,
            );
          }
        }

        const entry = methods.get('_init');
        if (entry && initialized.size > 0) {
          // Everything the construction sequence can reach: `_init` plus the
          // methods it calls, transitively.
          const reachable = new Set<string>(['_init']);
          const pending = [entry];
          const assigned = new Set<string>();

          while (pending.length > 0) {
            const body = pending.pop();
            if (!body) continue;
            const scanned = scanBody(body);
            for (const name of scanned.assigned) assigned.add(name);
            for (const name of scanned.called) {
              if (reachable.has(name)) continue;
              const method = methods.get(name);
              if (!method) continue;
              reachable.add(name);
              pending.push(method);
            }
          }

          for (const [name, line] of initialized) {
            if (!assigned.has(name)) continue;
            violations.push(
              `${file.slice(sourceRoot.length + 1)}:${line} \`${name}\` is written during ` +
                '`_init` but declared with a field initializer; use `declare`',
            );
          }
        }
      }

      ts.forEachChild(node, visitClass);
    };

    ts.forEachChild(source, visitClass);
  }

  assert.deepEqual(violations, []);
});
