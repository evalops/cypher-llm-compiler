import { createHash } from "node:crypto";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import type { CypherQuery, CypherSchemaContract } from "./ir.js";
import type { ParserValidationOptions, ParserValidationResult } from "./parser-validation.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import { liftRawCypherToIr, type RawLiftResult } from "./raw-lift.js";

export interface SourcePosition {
  offset: number;
  line: number;
  character: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

export type LosslessFragmentKind = "statement" | "terminator" | "trivia";

export interface LosslessFragment {
  kind: LosslessFragmentKind;
  span: SourceSpan;
  text: string;
}

export type LosslessTriviaKind = "line-comment" | "block-comment";

export interface LosslessTrivia {
  kind: LosslessTriviaKind;
  span: SourceSpan;
  text: string;
}

export interface LosslessClauseNode {
  index: number;
  kind: string;
  keyword: string;
  raw: string;
  body: string;
  span: SourceSpan;
  keywordSpan: SourceSpan;
  bodySpan: SourceSpan;
  irPath?: string;
  support: "lifted" | "raw" | "unknown";
}

export interface LosslessStatementNode {
  index: number;
  raw: string;
  span: SourceSpan;
  terminator?: LosslessFragment;
  clauses: LosslessClauseNode[];
}

export type LosslessSourceMapKind = "fragment" | "statement" | "clause" | "trivia" | "terminator";

export interface LosslessSourceMapEntry {
  id: string;
  kind: LosslessSourceMapKind;
  sourcePath: string;
  span: SourceSpan;
  text: string;
  sourceKind?: string;
  keyword?: string;
  support?: LosslessClauseNode["support"];
  irPath?: string;
}

export interface LosslessIrPreview {
  query: CypherQuery;
  renderedCypher: string;
  supportedClauses: number;
  rawClauses: number;
  parserOk?: boolean;
  diagnostics: Diagnostic[];
}

export interface LosslessRoundTrip {
  ok: boolean;
  bytes: number;
  sourceHash: string;
}

export interface LosslessParseReport {
  version: "cypher-llm-lossless-parse/v1";
  source: string;
  sourceHash: string;
  fragments: LosslessFragment[];
  trivia: LosslessTrivia[];
  statements: LosslessStatementNode[];
  sourceMap: LosslessSourceMapEntry[];
  diagnostics: Diagnostic[];
  roundTrip: LosslessRoundTrip;
  parser?: ParserValidationResult;
  irPreview?: LosslessIrPreview;
}

export interface LosslessParseOptions {
  schema?: CypherSchemaContract;
  parserMode?: ParserValidationOptions["mode"];
  includeIrPreview?: boolean;
}

interface LineIndex {
  starts: number[];
}

interface KeywordMatch {
  keyword: string;
  kind: string;
  start: number;
  end: number;
}

const CLAUSE_KEYWORDS = [
  ["OPTIONAL", "MATCH"],
  ["DETACH", "DELETE"],
  ["LOAD", "CSV"],
  ["UNION", "ALL"],
  ["MATCH"],
  ["RETURN"],
  ["WITH"],
  ["CALL"],
  ["UNWIND"],
  ["CREATE"],
  ["MERGE"],
  ["SET"],
  ["DELETE"],
  ["REMOVE"],
  ["FOREACH"],
  ["USE"],
  ["UNION"]
] as const;

const OPEN_TO_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}"
};

const CLOSE_TO_OPEN: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{"
};

export function parseCypherLosslessly(source: string, options: LosslessParseOptions = {}): LosslessParseReport {
  const lineIndex = buildLineIndex(source);
  const diagnostics: Diagnostic[] = [];
  const scanned = scanFragments(source, lineIndex, diagnostics);
  const statements = scanned.statements.map((statement, index) => ({
    ...statement,
    index,
    clauses: parseClauses(statement.raw, statement.span.start.offset, lineIndex).map((clause, clauseIndex) => ({
      ...clause,
      index: clauseIndex
    }))
  }));
  const sourceHash = sha256(source);
  const report: LosslessParseReport = {
    version: "cypher-llm-lossless-parse/v1",
    source,
    sourceHash,
    fragments: scanned.fragments,
    trivia: scanned.trivia,
    statements,
    sourceMap: [],
    diagnostics,
    roundTrip: {
      ok: roundTripLosslessFragments(scanned.fragments) === source,
      bytes: Buffer.byteLength(source, "utf8"),
      sourceHash
    }
  };

  if (!report.roundTrip.ok) {
    report.diagnostics.push(
      diagnostic({
        code: "lossless-roundtrip-mismatch",
        severity: "error",
        message: "Lossless parser fragments did not reconstruct the original Cypher source.",
        suggestion: "Treat this as a compiler bug and keep the original source as the source of truth."
      })
    );
  }

  if (options.schema) {
    report.parser = validateCypherTextWithParser(source, options.schema, { mode: options.parserMode ?? "syntax" });
  }

  if (options.includeIrPreview !== false) {
    const preview = buildIrPreview(report.statements, options);
    if (preview) {
      report.irPreview = preview;
    }
  }

  report.sourceMap = buildSourceMap(report);

  return report;
}

export function roundTripLosslessParse(report: Pick<LosslessParseReport, "fragments">): string {
  return roundTripLosslessFragments(report.fragments);
}

export function stripCypherComments(source: string): string {
  let output = "";
  for (let index = 0; index < source.length;) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      if (end === -1) {
        return output;
      }
      output += "\n";
      index = end + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      output += " ";
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const skipped = skipQuoted(source, index, char);
      output += source.slice(index, skipped.end);
      index = skipped.end;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function scanFragments(
  source: string,
  lineIndex: LineIndex,
  diagnostics: Diagnostic[]
): { fragments: LosslessFragment[]; statements: LosslessStatementNode[]; trivia: LosslessTrivia[] } {
  const fragments: LosslessFragment[] = [];
  const statements: LosslessStatementNode[] = [];
  const trivia: LosslessTrivia[] = [];
  const stack: { char: string; offset: number }[] = [];
  let statementStart = 0;

  for (let index = 0; index < source.length;) {
    const char = source[index] as string;
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      const commentEnd = end === -1 ? source.length : end;
      trivia.push({
        kind: "line-comment",
        span: span(lineIndex, index, commentEnd),
        text: source.slice(index, commentEnd)
      });
      index = commentEnd;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const commentEnd = end === -1 ? source.length : end + 2;
      trivia.push({
        kind: "block-comment",
        span: span(lineIndex, index, commentEnd),
        text: source.slice(index, commentEnd)
      });
      if (end === -1) {
        diagnostics.push(tokenDiagnostic("lossless-unterminated-token", "Unterminated block comment.", index, lineIndex));
      }
      index = commentEnd;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      const skipped = skipQuoted(source, index, char);
      if (!skipped.closed) {
        diagnostics.push(tokenDiagnostic("lossless-unterminated-token", `Unterminated ${tokenName(char)}.`, index, lineIndex));
      }
      index = skipped.end;
      continue;
    }

    if (OPEN_TO_CLOSE[char]) {
      stack.push({ char, offset: index });
      index += 1;
      continue;
    }

    if (CLOSE_TO_OPEN[char]) {
      const expectedOpen = CLOSE_TO_OPEN[char];
      const top = stack.at(-1);
      if (top?.char === expectedOpen) {
        stack.pop();
      } else {
        diagnostics.push(
          tokenDiagnostic("lossless-unmatched-delimiter", `Unmatched closing delimiter '${char}'.`, index, lineIndex)
        );
      }
      index += 1;
      continue;
    }

    if (char === ";" && stack.length === 0) {
      addStatementOrTrivia(source, statementStart, index, lineIndex, fragments, statements);
      const terminator: LosslessFragment = { kind: "terminator", span: span(lineIndex, index, index + 1), text: ";" };
      fragments.push(terminator);
      if (statements.at(-1) && !statements.at(-1)?.terminator) {
        statements[statements.length - 1] = {
          ...(statements.at(-1) as LosslessStatementNode),
          terminator
        };
      }
      statementStart = index + 1;
    }

    index += 1;
  }

  addStatementOrTrivia(source, statementStart, source.length, lineIndex, fragments, statements);

  for (const item of stack) {
    diagnostics.push(
      tokenDiagnostic(
        "lossless-unmatched-delimiter",
        `Unclosed delimiter '${item.char}', expected '${OPEN_TO_CLOSE[item.char]}'.`,
        item.offset,
        lineIndex
      )
    );
  }

  return { fragments, statements, trivia };
}

function addStatementOrTrivia(
  source: string,
  start: number,
  end: number,
  lineIndex: LineIndex,
  fragments: LosslessFragment[],
  statements: LosslessStatementNode[]
) {
  if (end <= start) {
    return;
  }
  const text = source.slice(start, end);
  if (hasCypherCode(text)) {
    const fragment: LosslessFragment = { kind: "statement", span: span(lineIndex, start, end), text };
    fragments.push(fragment);
    statements.push({
      index: statements.length,
      raw: text,
      span: fragment.span,
      clauses: []
    });
    return;
  }
  fragments.push({ kind: "trivia", span: span(lineIndex, start, end), text });
}

function parseClauses(source: string, offset: number, lineIndex: LineIndex): LosslessClauseNode[] {
  const matches = findClauseStarts(source);
  if (matches.length === 0) {
    return hasCypherCode(source)
      ? [
          {
            index: 0,
            kind: "raw",
            keyword: "RAW",
            raw: source,
            body: source,
            span: span(lineIndex, offset, offset + source.length),
            keywordSpan: span(lineIndex, offset, offset),
            bodySpan: span(lineIndex, offset, offset + source.length),
            support: "raw"
          }
        ]
      : [];
  }

  return matches.map((match, index) => {
    const end = matches[index + 1]?.start ?? source.length;
    const raw = source.slice(match.start, end);
    return {
      index,
      kind: match.kind,
      keyword: match.keyword,
      raw,
      body: source.slice(match.end, end),
      span: span(lineIndex, offset + match.start, offset + end),
      keywordSpan: span(lineIndex, offset + match.start, offset + match.end),
      bodySpan: span(lineIndex, offset + match.end, offset + end),
      support: "unknown"
    };
  });
}

function findClauseStarts(source: string): KeywordMatch[] {
  const matches: KeywordMatch[] = [];
  const stack: string[] = [];
  for (let index = 0; index < source.length;) {
    const char = source[index] as string;
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      index = skipQuoted(source, index, char).end;
      continue;
    }
    if (OPEN_TO_CLOSE[char]) {
      stack.push(char);
      index += 1;
      continue;
    }
    if (CLOSE_TO_OPEN[char]) {
      if (stack.at(-1) === CLOSE_TO_OPEN[char]) {
        stack.pop();
      }
      index += 1;
      continue;
    }
    if (stack.length === 0) {
      const match = keywordAt(source, index);
      if (match) {
        matches.push(match);
        index = match.end;
        continue;
      }
    }
    index += 1;
  }
  return matches;
}

function keywordAt(source: string, start: number): KeywordMatch | undefined {
  if (!isBoundaryBefore(source, start)) {
    return undefined;
  }
  for (const parts of CLAUSE_KEYWORDS) {
    let index = start;
    let ok = true;
    for (const [partIndex, part] of parts.entries()) {
      if (partIndex > 0) {
        const whitespaceStart = index;
        while (/\s/.test(source[index] ?? "")) {
          index += 1;
        }
        if (index === whitespaceStart) {
          ok = false;
          break;
        }
      }
      if (source.slice(index, index + part.length).toUpperCase() !== part) {
        ok = false;
        break;
      }
      index += part.length;
      if (!isBoundaryAfter(source, index)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const keyword = parts.join(" ");
      return {
        keyword,
        kind: keyword.toLowerCase().replace(/\s+/g, "-"),
        start,
        end: index
      };
    }
  }
  return undefined;
}

function buildIrPreview(statements: LosslessStatementNode[], options: LosslessParseOptions): LosslessIrPreview | undefined {
  if (statements.length !== 1) {
    return undefined;
  }
  const statement = statements[0];
  if (!statement || statement.clauses.length === 0) {
    return undefined;
  }
  const liftSource = statement.clauses
    .map((clause) => stripCypherComments(clause.raw).trim())
    .filter(Boolean)
    .join(" ");
  if (liftSource.length === 0) {
    return undefined;
  }
  const lifted: RawLiftResult = liftRawCypherToIr(liftSource, options.schema, {
    profile: "raw-compatible",
    parserMode: options.parserMode ?? "syntax"
  });
  for (const [index, clause] of statement.clauses.entries()) {
    const liftedClause = lifted.query.clauses[index];
    if (!liftedClause) {
      clause.support = "unknown";
      continue;
    }
    if (liftedClause.kind === "raw") {
      clause.support = "raw";
      continue;
    }
    clause.support = "lifted";
    clause.irPath = `/clauses/${index}`;
  }
  return {
    query: lifted.query,
    renderedCypher: lifted.renderedCypher,
    supportedClauses: lifted.supportedClauses,
    rawClauses: lifted.rawClauses,
    ...(lifted.parserOk !== undefined ? { parserOk: lifted.parserOk } : {}),
    diagnostics: lifted.diagnostics
  };
}

function buildSourceMap(report: Pick<LosslessParseReport, "fragments" | "trivia" | "statements">): LosslessSourceMapEntry[] {
  const entries: LosslessSourceMapEntry[] = [];

  for (const [index, fragment] of report.fragments.entries()) {
    entries.push({
      id: sourceMapId("fragment", fragment.span),
      kind: "fragment",
      sourcePath: `/fragments/${index}`,
      span: fragment.span,
      text: fragment.text,
      sourceKind: fragment.kind
    });
  }

  for (const [index, trivia] of report.trivia.entries()) {
    entries.push({
      id: sourceMapId("trivia", trivia.span),
      kind: "trivia",
      sourcePath: `/trivia/${index}`,
      span: trivia.span,
      text: trivia.text,
      sourceKind: trivia.kind
    });
  }

  for (const statement of report.statements) {
    entries.push({
      id: sourceMapId("statement", statement.span),
      kind: "statement",
      sourcePath: `/statements/${statement.index}`,
      span: statement.span,
      text: statement.raw
    });
    if (statement.terminator) {
      entries.push({
        id: sourceMapId("terminator", statement.terminator.span),
        kind: "terminator",
        sourcePath: `/statements/${statement.index}/terminator`,
        span: statement.terminator.span,
        text: statement.terminator.text,
        sourceKind: statement.terminator.kind
      });
    }
    for (const clause of statement.clauses) {
      entries.push({
        id: sourceMapId("clause", clause.span),
        kind: "clause",
        sourcePath: `/statements/${statement.index}/clauses/${clause.index}`,
        span: clause.span,
        text: clause.raw,
        sourceKind: clause.kind,
        keyword: clause.keyword,
        support: clause.support,
        ...(clause.irPath ? { irPath: clause.irPath } : {})
      });
    }
  }

  return entries;
}

function sourceMapId(kind: LosslessSourceMapKind, span: SourceSpan): string {
  return `${kind}:${span.start.offset}-${span.end.offset}`;
}

function hasCypherCode(source: string): boolean {
  return stripCypherComments(source).trim().length > 0;
}

function roundTripLosslessFragments(fragments: LosslessFragment[]): string {
  return fragments.map((fragment) => fragment.text).join("");
}

function skipQuoted(source: string, start: number, quote: string): { end: number; closed: boolean } {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\\" && quote !== "`") {
      index += 1;
      continue;
    }
    if (char === quote && next === quote) {
      index += 1;
      continue;
    }
    if (char === quote) {
      return { end: index + 1, closed: true };
    }
  }
  return { end: source.length, closed: false };
}

function tokenName(token: string): string {
  return token === "`" ? "backtick identifier" : `${token} string`;
}

function tokenDiagnostic(code: string, message: string, offset: number, lineIndex: LineIndex): Diagnostic {
  const location = positionAt(lineIndex, offset);
  return diagnostic({
    code,
    severity: "error",
    message,
    path: `line:${location.line + 1}:character:${location.character + 1}`,
    suggestion: "Use the lossless spans to target the exact source range before attempting an IR rewrite."
  });
}

function span(lineIndex: LineIndex, start: number, end: number): SourceSpan {
  return {
    start: positionAt(lineIndex, start),
    end: positionAt(lineIndex, end)
  };
}

function buildLineIndex(source: string): LineIndex {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return { starts };
}

function positionAt(lineIndex: LineIndex, offset: number): SourcePosition {
  let low = 0;
  let high = lineIndex.starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineIndex.starts[mid] ?? 0;
    const next = lineIndex.starts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = mid - 1;
    } else if (offset >= next) {
      low = mid + 1;
    } else {
      return { offset, line: mid, character: offset - start };
    }
  }
  const lastLine = Math.max(0, lineIndex.starts.length - 1);
  return { offset, line: lastLine, character: offset - (lineIndex.starts[lastLine] ?? 0) };
}

function isBoundaryBefore(source: string, index: number): boolean {
  return index === 0 || !isIdentifierChar(source[index - 1] ?? "");
}

function isBoundaryAfter(source: string, index: number): boolean {
  return index >= source.length || !isIdentifierChar(source[index] ?? "");
}

function isIdentifierChar(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
