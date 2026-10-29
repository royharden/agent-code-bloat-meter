// plan D24 / 9 G3: no exported identifier anywhere in src/ contains "score" or "bloat" (case-insensitive). Checked on
// the syntax tree of every .ts/.tsx file under src/. Never run in Dirty Mode.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const SRC = new URL('../src/', import.meta.url);
const FORBIDDEN = /score|bloat/i;

function walk(dir: URL, prefix: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const url = new URL(name, dir);
    if (statSync(url).isDirectory()) return walk(new URL(`${name}/`, dir), `${prefix}${name}/`);
    return name.endsWith('.ts') || name.endsWith('.tsx') ? [`${prefix}${name}`] : [];
  });
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Every exported name of a module: exported declarations, export specifiers and `export =` / default identifiers. */
export function exportedNames(path: string, text: string): string[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names: string[] = [];
  const bindingNames = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.push(name.text);
    else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name);
  };
  for (const statement of sf.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
        for (const spec of statement.exportClause.elements) names.push(spec.name.text);
      } else if (statement.exportClause !== undefined && ts.isNamespaceExport(statement.exportClause)) {
        names.push(statement.exportClause.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) names.push(statement.expression.text);
      continue;
    }
    if (!hasExportModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) bindingNames(d.name);
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.push(statement.name.text);
    }
  }
  return names;
}

describe('G3: no exported score/bloat identifier in src/', () => {
  const files = walk(SRC, 'src/');

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s', (path) => {
    const names = exportedNames(path, readFileSync(new URL(path.slice('src/'.length), SRC), 'utf8'));
    expect(names.filter((n) => FORBIDDEN.test(n))).toEqual([]);
  });

  it('the extractor sees every export form', () => {
    const text = [
      'export const riskScore = 1, { bloatA } = {} as any;',
      'export function scoreIt() {}',
      'export class BloatMeter {}',
      'export interface Scored {}',
      'export type BloatType = 1;',
      'const local = 1;',
      'export { local as hiddenScore };',
      "export * as bloatNs from './x';",
    ].join('\n');
    // riskScore, bloatA, scoreIt, BloatMeter, Scored, BloatType, hiddenScore, bloatNs
    expect(exportedNames('x.ts', text).filter((n) => FORBIDDEN.test(n)).length).toBe(8);
  });
});
