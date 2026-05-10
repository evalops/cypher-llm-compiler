import { diagnostic, type Diagnostic } from "./diagnostics.js";
import type { EvalAttemptSet, EvalDataset } from "./evals.js";
import type {
  CallClause,
  Clause,
  CypherQuery,
  CypherSchemaContract,
  Expression,
  MatchClause,
  NodePattern,
  PathPattern,
  ProjectionItem,
  RelationshipDirection,
  RelationshipPattern,
  ReturnClause,
  BinaryOperator,
  WithClause
} from "./ir.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import { renderQuery } from "./render.js";

export interface RawLiftOptions {
  profile?: CypherQuery["profile"];
  parserMode?: "syntax" | "lint";
}

export interface RawLiftResult {
  version: "cypher-llm-raw-lift/v1";
  inputCypher: string;
  query: CypherQuery;
  renderedCypher: string;
  diagnostics: Diagnostic[];
  parserOk?: boolean;
  supportedClauses: number;
  rawClauses: number;
}

export interface RawLiftEvalReport {
  version: "cypher-llm-raw-lift-eval/v1";
  datasetName: string;
  rawAttempts: number;
  fullyLifted: number;
  partiallyLifted: number;
  unsupported: number;
  diagnosticsByCode: Record<string, number>;
  results: RawLiftEvalResult[];
}

export interface RawLiftEvalResult {
  taskId: string;
  supportedClauses: number;
  rawClauses: number;
  renderedCypher: string;
  diagnostics: string[];
}

export function liftRawCypherToIr(
  cypher: string,
  schema?: CypherSchemaContract,
  options: RawLiftOptions = {}
): RawLiftResult {
  const diagnostics: Diagnostic[] = [];
  const clauses = splitClauses(cypher).map((clause, index) => liftClause(clause, index, diagnostics));
  const query: CypherQuery = {
    version: "cypher-llm-ir/v1",
    ...(options.profile ? { profile: options.profile } : {}),
    clauses
  };
  const renderedCypher = renderQuery(query);
  if (schema) {
    const parser = validateCypherTextWithParser(renderedCypher, schema, { mode: options.parserMode ?? "syntax" });
    diagnostics.push(
      ...parser.diagnostics.map((item) =>
        diagnostic({
          code: "raw-lift-parser-diagnostic",
          severity: item.severity,
          message: item.message,
          ...(item.path ? { path: item.path } : {}),
          suggestion: "Fix the lifted IR or keep the unsupported syntax as an explicit raw clause."
        })
      )
    );
  }
  const rawClauses = clauses.filter((clause) => clause.kind === "raw").length;
  return {
    version: "cypher-llm-raw-lift/v1",
    inputCypher: cypher,
    query,
    renderedCypher,
    diagnostics,
    ...(schema ? { parserOk: !diagnostics.some((item) => item.code === "raw-lift-parser-diagnostic" && item.severity === "error") } : {}),
    supportedClauses: clauses.length - rawClauses,
    rawClauses
  };
}

export function evaluateRawLiftAttempts(dataset: EvalDataset, attempts: EvalAttemptSet): RawLiftEvalReport {
  const tasksById = new Map(dataset.tasks.map((task) => [task.id, task]));
  const results: RawLiftEvalResult[] = [];
  for (const attempt of attempts.attempts) {
    if (!attempt.rawCypher) {
      continue;
    }
    const task = tasksById.get(attempt.taskId);
    if (!task) {
      continue;
    }
    const lifted = liftRawCypherToIr(attempt.rawCypher, task.schema, { profile: "raw-compatible" });
    results.push({
      taskId: attempt.taskId,
      supportedClauses: lifted.supportedClauses,
      rawClauses: lifted.rawClauses,
      renderedCypher: lifted.renderedCypher,
      diagnostics: lifted.diagnostics.map((item) => item.code)
    });
  }
  const rawAttempts = results.length;
  const fullyLifted = results.filter((result) => result.rawClauses === 0).length;
  const partiallyLifted = results.filter((result) => result.rawClauses > 0 && result.supportedClauses > 0).length;
  const unsupported = results.filter((result) => result.rawClauses > 0 && result.supportedClauses === 0).length;
  return {
    version: "cypher-llm-raw-lift-eval/v1",
    datasetName: dataset.name,
    rawAttempts,
    fullyLifted,
    partiallyLifted,
    unsupported,
    diagnosticsByCode: countDiagnostics(results),
    results
  };
}

function liftClause(clause: string, index: number, diagnostics: Diagnostic[]): Clause {
  const trimmed = clause.trim();
  try {
    if (/^OPTIONAL\s+MATCH\b/i.test(trimmed) || /^MATCH\b/i.test(trimmed)) {
      return liftMatch(trimmed);
    }
    if (/^WITH\b/i.test(trimmed)) {
      return liftWith(trimmed);
    }
    if (/^RETURN\b/i.test(trimmed)) {
      return liftReturn(trimmed);
    }
    if (/^CALL\b/i.test(trimmed) && !/^CALL\s*\{/i.test(trimmed)) {
      return liftCall(trimmed);
    }
  } catch (error) {
    diagnostics.push(unsupportedDiagnostic(index, trimmed, error instanceof Error ? error.message : String(error)));
    return { kind: "raw", cypher: trimmed, reason: "raw-lift-failed" };
  }
  diagnostics.push(unsupportedDiagnostic(index, trimmed, "Clause shape is outside the raw-to-IR migration subset."));
  return { kind: "raw", cypher: trimmed, reason: "raw-lift-unsupported" };
}

function liftMatch(clause: string): MatchClause {
  const optional = /^OPTIONAL\s+MATCH\b/i.test(clause);
  const body = clause.replace(/^OPTIONAL\s+MATCH\b/i, "").replace(/^MATCH\b/i, "").trim();
  const [patternText, whereText] = splitKeyword(body, "WHERE");
  return {
    kind: "match",
    ...(optional ? { optional } : {}),
    patterns: splitTopLevel(patternText, ",").map(parsePath),
    ...(whereText ? { where: parseExpression(whereText) } : {})
  };
}

function liftWith(clause: string): WithClause {
  const body = clause.replace(/^WITH\b/i, "").trim();
  const distinct = /^DISTINCT\b/i.test(body);
  const withoutDistinct = distinct ? body.replace(/^DISTINCT\b/i, "").trim() : body;
  const [beforeWhere, whereText] = splitKeyword(withoutDistinct, "WHERE");
  const { projectionText, orderBy, skip, limit } = extractProjectionModifiers(beforeWhere);
  const items = parseProjectionList(projectionText);
  return {
    kind: "with",
    ...(distinct ? { distinct } : {}),
    ...(items.some((item) => item.expression.kind === "raw" && item.expression.cypher === "*") ? { includeExisting: true } : {}),
    items: items.filter((item) => !(item.expression.kind === "raw" && item.expression.cypher === "*")),
    ...(whereText ? { where: parseExpression(whereText) } : {}),
    ...(orderBy.length > 0 ? { orderBy } : {}),
    ...(skip ? { skip } : {}),
    ...(limit ? { limit } : {})
  };
}

function liftReturn(clause: string): ReturnClause {
  const body = clause.replace(/^RETURN\b/i, "").trim();
  const distinct = /^DISTINCT\b/i.test(body);
  const withoutDistinct = distinct ? body.replace(/^DISTINCT\b/i, "").trim() : body;
  const { projectionText, orderBy, skip, limit } = extractProjectionModifiers(withoutDistinct);
  return {
    kind: "return",
    ...(distinct ? { distinct } : {}),
    items: parseProjectionList(projectionText),
    ...(orderBy.length > 0 ? { orderBy } : {}),
    ...(skip ? { skip } : {}),
    ...(limit ? { limit } : {})
  };
}

function liftCall(clause: string): CallClause {
  const match = /^CALL\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\((.*?)\)\s*(?:YIELD\s+(.+))?$/i.exec(clause);
  if (!match?.[1]) {
    throw new Error("Unsupported CALL shape.");
  }
  return {
    kind: "call",
    procedure: match[1],
    arguments: splitTopLevel(match[2] ?? "", ",").filter(Boolean).map(parseExpression),
    ...(match[3] ? { yield: parseProjectionList(match[3]) } : {})
  };
}

function parsePath(text: string): PathPattern {
  const named = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(text.trim());
  if (named?.[1] && named[2]) {
    return { ...parsePath(named[2]), name: named[1] };
  }
  const match = /^\s*(\([^)]*\))\s*(<-|-)\s*(\[[^\]]*\])\s*(->|-)\s*(\([^)]*\))\s*$/.exec(text);
  if (!match) {
    if (!/^\s*\([^)]*\)\s*$/.test(text)) {
      throw new Error("Unsupported MATCH path shape.");
    }
    return { segments: [parseNode(text)] };
  }
  const direction = relationshipDirection(match[2] as string, match[4] as string);
  return {
    segments: [
      parseNode(match[1] as string),
      {
        rel: parseRelationship(match[3] as string, direction),
        node: parseNode(match[5] as string)
      }
    ]
  };
}

function parseNode(text: string): NodePattern {
  const body = text.trim().replace(/^\(/, "").replace(/\)$/, "").trim();
  const propertyStart = body.indexOf("{");
  const propertyText = propertyStart >= 0 ? body.slice(propertyStart).replace(/^\{|\}$/g, "") : undefined;
  const head = propertyStart >= 0 ? body.slice(0, propertyStart).trim() : body;
  const variableMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(head);
  const labels = [...head.matchAll(/:`([^`]+)`|:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1] ?? match[2] ?? "");
  return {
    ...(variableMatch?.[1] ? { variable: variableMatch[1] } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(propertyText ? { properties: parsePropertyMap(propertyText) } : {})
  };
}

function parseRelationship(text: string, direction: RelationshipDirection): RelationshipPattern {
  let body = text.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  const propertyStart = body.indexOf("{");
  const propertyText = propertyStart >= 0 ? body.slice(propertyStart).replace(/^\{|\}$/g, "") : undefined;
  body = propertyStart >= 0 ? body.slice(0, propertyStart).trim() : body;
  const rangeMatch = /\*(\d*)?(?:\.\.(\d*)?)?/.exec(body);
  if (rangeMatch) {
    body = body.replace(rangeMatch[0], "");
  }
  const colonIndex = body.indexOf(":");
  const variable = colonIndex > 0 ? body.slice(0, colonIndex).trim() : "";
  const typeText = colonIndex >= 0 ? body.slice(colonIndex + 1).trim() : "";
  const types = splitTopLevel(typeText, "|").map(stripBackticks).filter(Boolean);
  return {
    ...(variable ? { variable } : {}),
    ...(types.length > 0 ? { types } : {}),
    direction,
    ...(rangeMatch ? rangeFromMatch(rangeMatch) : {}),
    ...(propertyText ? { properties: parsePropertyMap(propertyText) } : {})
  };
}

function parseProjectionList(text: string): ProjectionItem[] {
  return splitTopLevel(text, ",").filter(Boolean).map((item) => {
    const match = /^(.+?)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(item.trim());
    if (match?.[1] && match[2]) {
      return { expression: parseExpression(match[1]), alias: match[2] };
    }
    return { expression: parseExpression(item) };
  });
}

function parseExpression(text: string): Expression {
  const trimmed = unwrapParens(text.trim());
  if (trimmed === "*") {
    return { kind: "raw", cypher: "*" };
  }
  const binary = parseBinaryExpression(trimmed);
  if (binary) {
    return binary;
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return { kind: "param", name: trimmed.slice(1) };
  }
  if (/^-?\d+$/.test(trimmed)) {
    return { kind: "literal", value: Number(trimmed) };
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return { kind: "literal", value: Number(trimmed) };
  }
  if (/^'.*'$|^".*"$/.test(trimmed)) {
    return { kind: "literal", value: trimmed.slice(1, -1) };
  }
  const functionMatch = /^([A-Za-z_][A-Za-z0-9_.]*)\((.*)\)$/.exec(trimmed);
  if (functionMatch?.[1]) {
    const rawArgumentText = functionMatch[2] ?? "";
    const distinct = /^DISTINCT\s+/i.test(rawArgumentText.trim());
    const argumentText = distinct ? rawArgumentText.trim().replace(/^DISTINCT\s+/i, "") : rawArgumentText;
    return {
      kind: "function",
      name: functionMatch[1],
      ...(distinct ? { distinct } : {}),
      arguments: splitTopLevel(argumentText, ",").filter(Boolean).map(parseExpression)
    };
  }
  const propMatch = /^([A-Za-z_][A-Za-z0-9_]*)\.`?([^`.\s]+(?: [^`.\s]+)*)`?$/.exec(trimmed);
  if (propMatch?.[1] && propMatch[2]) {
    return { kind: "prop", object: { kind: "var", name: propMatch[1] }, key: stripBackticks(propMatch[2]) };
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return { kind: "var", name: trimmed };
  }
  return { kind: "raw", cypher: trimmed };
}

function parseBinaryExpression(text: string): Expression | undefined {
  const tiers: BinaryOperator[][] = [
    ["OR", "XOR"],
    ["AND"],
    ["=", "<>", "<=", ">=", "<", ">", "IN", "CONTAINS", "STARTS WITH", "ENDS WITH"],
    ["+", "-"],
    ["*", "/", "%"],
    ["^"]
  ];
  for (const operators of tiers) {
    const match = findTopLevelOperator(text, operators);
    if (match) {
      return {
        kind: "binary",
        op: match.operator,
        left: parseExpression(text.slice(0, match.index)),
        right: parseExpression(text.slice(match.index + match.operator.length))
      };
    }
  }
  return undefined;
}

function parsePropertyMap(text: string): Record<string, Expression> {
  return Object.fromEntries(
    splitTopLevel(text, ",").map((entry) => {
      const [key, ...value] = splitTopLevel(entry, ":");
      return [stripBackticks((key ?? "").trim()), parseExpression(value.join(":"))];
    })
  );
}

function splitClauses(cypher: string): string[] {
  const keywords = ["OPTIONAL MATCH", "MATCH", "WITH", "RETURN", "CALL"];
  const starts: number[] = [];
  let state: "normal" | "single" | "double" | "backtick" = "normal";
  for (let index = 0; index < cypher.length; index += 1) {
    const char = cypher[index];
    if (state === "single") {
      if (char === "'") state = "normal";
      continue;
    }
    if (state === "double") {
      if (char === "\"") state = "normal";
      continue;
    }
    if (state === "backtick") {
      if (char === "`") state = "normal";
      continue;
    }
    if (char === "'") state = "single";
    if (char === "\"") state = "double";
    if (char === "`") state = "backtick";
    for (const keyword of keywords) {
      if (matchesKeywordAt(cypher, keyword, index)) {
        starts.push(index);
        break;
      }
    }
  }
  return starts.map((start, index) => cypher.slice(start, starts[index + 1] ?? cypher.length).trim()).filter(Boolean);
}

function matchesKeywordAt(text: string, keyword: string, index: number): boolean {
  if (index > 0 && /\S/.test(text[index - 1] ?? "")) {
    return false;
  }
  if (text.slice(index, index + keyword.length).toUpperCase() !== keyword) {
    return false;
  }
  const next = text[index + keyword.length];
  return next === undefined || /\s/.test(next);
}

function splitKeyword(text: string, keyword: string): [string, string | undefined] {
  const match = new RegExp(`\\s+${keyword}\\s+`, "i").exec(text);
  if (!match || match.index === undefined) {
    return [text.trim(), undefined];
  }
  return [text.slice(0, match.index).trim(), text.slice(match.index + match[0].length).trim()];
}

function extractProjectionModifiers(text: string): {
  projectionText: string;
  orderBy: { expression: Expression; direction?: "ASC" | "DESC" }[];
  skip?: Expression;
  limit?: Expression;
} {
  const modifierStart = firstTopLevelKeyword(text, ["ORDER BY", "SKIP", "LIMIT"]);
  if (!modifierStart) {
    return { projectionText: text.trim(), orderBy: [] };
  }
  const projectionText = text.slice(0, modifierStart.index).trim();
  const modifiers = text.slice(modifierStart.index);
  const orderText = keywordValue(modifiers, "ORDER BY", ["SKIP", "LIMIT"]);
  const skipText = keywordValue(modifiers, "SKIP", ["ORDER BY", "LIMIT"]);
  const limitText = keywordValue(modifiers, "LIMIT", ["ORDER BY", "SKIP"]);
  const result: {
    projectionText: string;
    orderBy: { expression: Expression; direction?: "ASC" | "DESC" }[];
    skip?: Expression;
    limit?: Expression;
  } = {
    projectionText,
    orderBy: orderText ? parseOrderBy(orderText) : []
  };
  if (skipText) {
    result.skip = parseExpression(skipText);
  }
  if (limitText) {
    result.limit = parseExpression(limitText);
  }
  return result;
}

function parseOrderBy(text: string): { expression: Expression; direction?: "ASC" | "DESC" }[] {
  return splitTopLevel(text, ",").filter(Boolean).map((item) => {
    const match = /^(.+?)\s+(ASC|DESC)$/i.exec(item.trim());
    if (match?.[1] && match[2]) {
      return { expression: parseExpression(match[1]), direction: match[2].toUpperCase() as "ASC" | "DESC" };
    }
    return { expression: parseExpression(item) };
  });
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let state: "normal" | "single" | "double" | "backtick" = "normal";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (state === "single") {
      if (char === "'") state = "normal";
      continue;
    }
    if (state === "double") {
      if (char === "\"") state = "normal";
      continue;
    }
    if (state === "backtick") {
      if (char === "`") state = "normal";
      continue;
    }
    if (char === "'") state = "single";
    else if (char === "\"") state = "double";
    else if (char === "`") state = "backtick";
    else if ("([{".includes(char ?? "")) depth += 1;
    else if (")]}".includes(char ?? "")) depth -= 1;
    else if (depth === 0 && text.startsWith(separator, index)) {
      parts.push(text.slice(start, index).trim());
      start = index + separator.length;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function relationshipDirection(left: string, right: string): RelationshipDirection {
  if (left === "<-") return "in";
  if (right === "->") return "out";
  return "undirected";
}

function rangeFromMatch(match: RegExpExecArray): Partial<RelationshipPattern> {
  const min = match[1] ? Number(match[1]) : undefined;
  const max = match[2] ? Number(match[2]) : match[0].includes("..") || match[0] === "*" ? null : undefined;
  return {
    ...(min !== undefined ? { minHops: min } : {}),
    ...(max !== undefined ? { maxHops: max } : {})
  };
}

function unsupportedDiagnostic(index: number, clause: string, reason: string): Diagnostic {
  return diagnostic({
    code: "raw-lift-unsupported-clause",
    severity: "warning",
    message: `Raw Cypher clause ${index} could not be lifted into structured IR: ${reason}`,
    path: `/clauses/${index}`,
    suggestion: "Keep this clause as an explicit raw escape hatch or rewrite it as supported CypherQuery IR.",
    repair: {
      kind: "rewrite-as-ir",
      description: "Rewrite the unsupported raw clause using structured IR."
    }
  });
}

function stripBackticks(value: string): string {
  return value.trim().replace(/^`|`$/g, "").replaceAll("``", "`");
}

function countDiagnostics(results: RawLiftEvalResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const diagnostic of result.diagnostics) {
      counts[diagnostic] = (counts[diagnostic] ?? 0) + 1;
    }
  }
  return counts;
}

function firstTopLevelKeyword(text: string, keywords: string[]): { keyword: string; index: number } | undefined {
  let best: { keyword: string; index: number } | undefined;
  for (const keyword of keywords) {
    const index = findTopLevelKeyword(text, keyword);
    if (index >= 0 && (!best || index < best.index)) {
      best = { keyword, index };
    }
  }
  return best;
}

function keywordValue(text: string, keyword: string, terminators: string[]): string | undefined {
  const start = findTopLevelKeyword(text, keyword);
  if (start < 0) {
    return undefined;
  }
  const bodyStart = start + keyword.length;
  const body = text.slice(bodyStart);
  const terminator = firstTopLevelKeyword(body, terminators);
  return body.slice(0, terminator?.index ?? body.length).trim() || undefined;
}

function findTopLevelKeyword(text: string, keyword: string): number {
  let depth = 0;
  let state: "normal" | "single" | "double" | "backtick" = "normal";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (state === "single") {
      if (char === "'") state = "normal";
      continue;
    }
    if (state === "double") {
      if (char === "\"") state = "normal";
      continue;
    }
    if (state === "backtick") {
      if (char === "`") state = "normal";
      continue;
    }
    if (char === "'") {
      state = "single";
      continue;
    }
    if (char === "\"") {
      state = "double";
      continue;
    }
    if (char === "`") {
      state = "backtick";
      continue;
    }
    if ("([{".includes(char ?? "")) {
      depth += 1;
      continue;
    }
    if (")]}".includes(char ?? "")) {
      depth -= 1;
      continue;
    }
    if (depth === 0 && matchesKeywordAt(text, keyword, index)) {
      return index;
    }
  }
  return -1;
}

function findTopLevelOperator(
  text: string,
  operators: BinaryOperator[]
): { operator: BinaryOperator; index: number } | undefined {
  let depth = 0;
  let state: "normal" | "single" | "double" | "backtick" = "normal";
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (state === "single") {
      if (char === "'") state = "normal";
      continue;
    }
    if (state === "double") {
      if (char === "\"") state = "normal";
      continue;
    }
    if (state === "backtick") {
      if (char === "`") state = "normal";
      continue;
    }
    if (char === "'") {
      state = "single";
      continue;
    }
    if (char === "\"") {
      state = "double";
      continue;
    }
    if (char === "`") {
      state = "backtick";
      continue;
    }
    if (")]}".includes(char ?? "")) {
      depth += 1;
      continue;
    }
    if ("([{".includes(char ?? "")) {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    for (const operator of operators) {
      if (
        matchesOperatorAt(text, operator, index) &&
        text.slice(0, index).trim().length > 0 &&
        text.slice(index + operator.length).trim().length > 0
      ) {
        return { operator, index };
      }
    }
  }
  return undefined;
}

function matchesOperatorAt(text: string, operator: BinaryOperator, index: number): boolean {
  const actual = text.slice(index, index + operator.length).toUpperCase();
  if (actual !== operator) {
    return false;
  }
  if (/^[A-Z ]+$/.test(operator)) {
    const previous = text[index - 1];
    const next = text[index + operator.length];
    return (previous === undefined || /\s|\(|\]/.test(previous)) && (next === undefined || /\s|\)|\[/.test(next));
  }
  if ((operator === "+" || operator === "-") && (index === 0 || /[(,=<>+\-*/%^]\s*$/.test(text.slice(0, index)))) {
    return false;
  }
  return true;
}

function unwrapParens(text: string): string {
  if (!text.startsWith("(") || !text.endsWith(")")) {
    return text;
  }
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && index < text.length - 1) {
      return text;
    }
  }
  return unwrapParens(text.slice(1, -1).trim());
}
