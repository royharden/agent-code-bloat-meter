// plan D35 / docs/ATOMS.md section 9: syntax-only parsing with `ts.createSourceFile` (no Program, no type checker, no
// tsconfig, no module resolution), plus the scanner pass and import facts used by the tier-0 inputs (plan 8.2).
// Analysed code is parsed only, never executed. Pure: no filesystem, no network.
import ts from 'typescript';
import type { SourceKind } from './change';
import type { Side, Span } from './types';

/** One parsed side of one `.ts` / `.tsx` file. */
export interface ParsedSide {
  path: string;
  side: Side;
  kind: SourceKind;
  /** Normalised text (docs/ATOMS.md section 3). */
  textLF: string;
  sourceFile: ts.SourceFile;
  /** D35: non-empty `parseDiagnostics`. */
  failed: boolean;
  diagnosticCount: number;
}

/**
 * D35: `ts.createSourceFile(path, textLF, ScriptTarget.Latest, true, TSX or TS by lower-cased extension)`; the side
 * fails to parse when `parseDiagnostics` (an internal field of the returned SourceFile) is non-empty.
 */
export function parseSide(path: string, side: Side, kind: SourceKind, textLF: string): ParsedSide {
  const sourceFile = ts.createSourceFile(
    path,
    textLF,
    ts.ScriptTarget.Latest,
    true,
    kind === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
  return { path, side, kind, textLF, sourceFile, failed: diagnostics.length > 0, diagnosticCount: diagnostics.length };
}

/** 1-based line of a character offset. */
export function lineOfPos(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * docs/METRICS.md section 2: [line(getStart()), line(last character)] — leading trivia (comments, whitespace) is
 * excluded; the end line is the line holding the node's last character.
 */
export function nodeLines(node: ts.Node, sourceFile: ts.SourceFile): { startLine: number; endLine: number } {
  const start = node.getStart(sourceFile);
  const end = Math.max(start, node.getEnd() - 1);
  return { startLine: lineOfPos(sourceFile, start), endLine: lineOfPos(sourceFile, end) };
}

export function nodeSpan(node: ts.Node, sourceFile: ts.SourceFile, path: string, side: Side): Span {
  const { startLine, endLine } = nodeLines(node, sourceFile);
  return { path, side, startLine, endLine };
}

/** Contiguous spans covering a set of lines (sorted ascending). */
export function linesToSpans(path: string, side: Side, lines: Iterable<number>): Span[] {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const spans: Span[] = [];
  for (const line of sorted) {
    const last = spans[spans.length - 1];
    if (last !== undefined && last.endLine + 1 === line) last.endLine = line;
    else spans.push({ path, side, startLine: line, endLine: line });
  }
  return spans;
}

/** Offsets at which each line starts (line 1 at index 0). */
function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: readonly number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** A non-trivia token from the raw scanner pass, with the lines it covers. */
export interface ScannedToken {
  kind: ts.SyntaxKind;
  text: string;
  startLine: number;
  endLine: number;
}

const TRIVIA_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.SingleLineCommentTrivia,
  ts.SyntaxKind.MultiLineCommentTrivia,
  ts.SyntaxKind.NewLineTrivia,
  ts.SyntaxKind.WhitespaceTrivia,
  ts.SyntaxKind.ShebangTrivia,
  ts.SyntaxKind.ConflictMarkerTrivia,
  ts.SyntaxKind.NonTextFileMarkerTrivia,
]);

/** Tokens after which a `/` is a division operator rather than the start of a regular expression literal. */
function endsExpression(kind: ts.SyntaxKind): boolean {
  switch (kind) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.PrivateIdentifier:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.TemplateTail:
    case ts.SyntaxKind.CloseParenToken:
    case ts.SyntaxKind.CloseBracketToken:
    case ts.SyntaxKind.CloseBraceToken:
    case ts.SyntaxKind.PlusPlusToken:
    case ts.SyntaxKind.MinusMinusToken:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.SuperKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
      return true;
    default:
      // Contextual keywords (`type`, `of`, `get`, ...) are usually identifiers in expression position.
      return kind >= ts.SyntaxKind.FirstContextualKeyword && kind <= ts.SyntaxKind.LastContextualKeyword;
  }
}

/**
 * plan 8.2 T0a/T0b: one full-file `ts.createScanner(Latest, skipTrivia = false, ...)` pass over the normalised text,
 * keeping non-trivia tokens. Multi-line comments are trivia, so their lines carry no token. The pass re-scans
 * template continuations after a `}` that closes a `${` (so template text is never read as code) and re-scans `/`
 * as a regular expression where an expression is expected (previous token heuristic). Known limitation
 * (docs/POLICY.md section 1): without the parser, JSX text and some `/` positions can still be misread.
 */
export function scanNonTriviaTokens(textLF: string, kind: SourceKind): ScannedToken[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    kind === 'tsx' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    textLF,
  );
  const starts = lineStartOffsets(textLF);
  const tokens: ScannedToken[] = [];
  const braces: ('{' | '${')[] = [];
  let previous: ts.SyntaxKind | null = null;
  // The scanner always advances; the guard only bounds a pathological loop.
  for (let guard = 0; guard <= textLF.length + 1; guard++) {
    let token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) break;
    if (TRIVIA_KINDS.has(token)) continue;
    if (token === ts.SyntaxKind.OpenBraceToken) braces.push('{');
    else if (token === ts.SyntaxKind.TemplateHead) braces.push('${');
    else if (token === ts.SyntaxKind.CloseBraceToken) {
      if (braces.pop() === '${') {
        token = scanner.reScanTemplateToken(false);
        if (token === ts.SyntaxKind.TemplateMiddle) braces.push('${');
      }
    } else if (
      (token === ts.SyntaxKind.SlashToken || token === ts.SyntaxKind.SlashEqualsToken) &&
      (previous === null || !endsExpression(previous))
    ) {
      token = scanner.reScanSlashToken();
    }
    const start = scanner.getTokenStart();
    const end = scanner.getTokenEnd();
    tokens.push({
      kind: token,
      text: scanner.getTokenText(),
      startLine: lineAt(starts, start),
      endLine: lineAt(starts, Math.max(start, end - 1)),
    });
    previous = token;
  }
  return tokens;
}

/** Lines covered by at least one token (a token spanning lines covers each of them). */
export function tokenLines(tokens: readonly ScannedToken[]): Set<number> {
  const lines = new Set<number>();
  for (const t of tokens) {
    for (let line = t.startLine; line <= t.endLine; line++) lines.add(line);
  }
  return lines;
}

/** A top-level ImportDeclaration: its line range and whitespace-normalised text (plan 8.2 T0c). */
export interface ImportFact {
  startLine: number;
  endLine: number;
  normalisedText: string;
}

/** plan 8.2 T0c: top-level `ImportDeclaration`s with whitespace runs collapsed to one space and trimmed. */
export function topLevelImports(sourceFile: ts.SourceFile): ImportFact[] {
  const out: ImportFact[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const { startLine, endLine } = nodeLines(statement, sourceFile);
    out.push({ startLine, endLine, normalisedText: statement.getText(sourceFile).replace(/\s+/g, ' ').trim() });
  }
  return out;
}
