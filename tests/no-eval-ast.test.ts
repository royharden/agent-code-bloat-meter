// plan 6.1 / 9 G2: analysed code is parsed only. No dynamic code execution or module loading anywhere in src/core or
// src/diffmetrics, checked on the syntax tree (not by grep). Never run in Dirty Mode.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const ROOT = new URL('../', import.meta.url);
const DIRS = ['src/core/', 'src/diffmetrics/'];

function sourceFiles(): string[] {
  return DIRS.flatMap((dir) =>
    readdirSync(new URL(dir, ROOT))
      .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
      .map((name) => `${dir}${name}`),
  );
}

const FORBIDDEN_CALLEES = new Set(['eval', 'require', 'Function']);

/** Returns a description of every forbidden construct in one file. */
export function forbiddenConstructs(path: string, text: string): string[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const at = (node: ts.Node): string => `${path}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const calleeName = (e: ts.Expression): string | null => {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return e.argumentExpression.text;
    return null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push(`dynamic module load at ${at(node)}`);
      const name = calleeName(node.expression);
      if (name !== null && FORBIDDEN_CALLEES.has(name)) found.push(`${name}(...) at ${at(node)}`);
    }
    if (ts.isNewExpression(node) && calleeName(node.expression) === 'Function') found.push(`new Function at ${at(node)}`);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      found.push(`import = require at ${at(node)}`);
    }
    if (ts.isImportTypeNode(node)) found.push(`import type expression at ${at(node)}`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('G2: no code execution of input in src/core and src/diffmetrics', () => {
  it('finds the analyser modules', () => {
    const files = sourceFiles();
    expect(files).toContain('src/core/parse.ts');
    expect(files).toContain('src/diffmetrics/index.ts');
  });

  it.each(sourceFiles())('%s has no forbidden construct', (path) => {
    expect(forbiddenConstructs(path, readFileSync(new URL(path, ROOT), 'utf8'))).toEqual([]);
  });

  it('the detector itself catches each construct', () => {
    const bad = [
      'eval("1");',
      'globalThis.eval("1");',
      "require('fs');",
      "const f = new Function('return 1');",
      'Function("x")();',
      "void import('fs');",
      "import fs = require('fs');",
    ].join('\n');
    expect(forbiddenConstructs('bad.ts', bad).length).toBe(7);
  });
});
