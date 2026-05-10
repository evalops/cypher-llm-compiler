import type {
  Binding,
  CallClause,
  Clause,
  CreateClause,
  CypherQuery,
  DeleteClause,
  Expression,
  JsonLiteral,
  LetClause,
  MatchClause,
  MergeClause,
  NodePattern,
  OrderItem,
  PathPattern,
  ProjectionItem,
  RelationshipPattern,
  ReturnClause,
  SetClause,
  SetItem,
  UnwindClause,
  WithClause
} from "./ir.js";
import { cypherIdentifier, isBareIdentifier } from "./schema.js";

export interface RenderOptions {
  alwaysEscapeSchemaIdentifiers?: boolean;
  newline?: string;
}

const DEFAULT_RENDER_OPTIONS: Required<RenderOptions> = {
  alwaysEscapeSchemaIdentifiers: true,
  newline: "\n"
};

export function renderQuery(query: CypherQuery, options: RenderOptions = {}): string {
  const opts = { ...DEFAULT_RENDER_OPTIONS, ...options };
  return query.clauses.map((clause) => renderClause(clause, opts)).join(opts.newline);
}

export function renderClause(clause: Clause, options: Required<RenderOptions> = DEFAULT_RENDER_OPTIONS): string {
  switch (clause.kind) {
    case "match":
      return renderMatch(clause, options);
    case "unwind":
      return renderUnwind(clause, options);
    case "let":
      return renderLet(clause, options);
    case "with":
      return renderWith(clause, options);
    case "return":
      return renderReturn(clause, options);
    case "call":
      return renderCall(clause, options);
    case "create":
      return renderCreate(clause, options);
    case "merge":
      return renderMerge(clause, options);
    case "delete":
      return renderDelete(clause, options);
    case "set":
      return renderSet(clause, options);
    case "raw":
      return clause.cypher;
  }
}

export function renderExpression(expression: Expression, options: RenderOptions = {}): string {
  const opts = { ...DEFAULT_RENDER_OPTIONS, ...options };
  return renderExpressionWithOptions(expression, opts);
}

export function renderPath(pattern: PathPattern, options: RenderOptions = {}): string {
  const opts = { ...DEFAULT_RENDER_OPTIONS, ...options };
  const [head, ...tail] = pattern.segments;
  let rendered = renderNode(head, opts);
  for (const segment of tail) {
    rendered += renderRelationship(segment.rel, opts) + renderNode(segment.node, opts);
  }

  const shortestPrefix = pattern.shortest === "any" ? "ANY SHORTEST " : pattern.shortest === "all" ? "ALL SHORTEST " : "";
  const path = `${shortestPrefix}${rendered}`;
  return pattern.name ? `${renderVariable(pattern.name)} = ${path}` : path;
}

function renderMatch(clause: MatchClause, options: Required<RenderOptions>): string {
  const lines = [
    `${clause.optional ? "OPTIONAL MATCH" : "MATCH"} ${clause.patterns
      .map((pattern) => renderPath(pattern, options))
      .join(", ")}`
  ];
  if (clause.where) {
    lines.push(`WHERE ${renderExpressionWithOptions(clause.where, options)}`);
  }
  return lines.join(options.newline);
}

function renderUnwind(clause: UnwindClause, options: Required<RenderOptions>): string {
  return `UNWIND ${renderExpressionWithOptions(clause.expression, options)} AS ${renderVariable(clause.alias)}`;
}

function renderLet(clause: LetClause, options: Required<RenderOptions>): string {
  return `LET ${clause.bindings.map((binding) => renderBinding(binding, options)).join(", ")}`;
}

function renderWith(clause: WithClause, options: Required<RenderOptions>): string {
  const projection = renderProjectionList(clause.items, options, clause.includeExisting);
  const lines = [`WITH ${clause.distinct ? "DISTINCT " : ""}${projection}`];
  appendOrderSkipLimit(lines, clause.orderBy, clause.skip, clause.limit, options);
  if (clause.where) {
    lines.push(`WHERE ${renderExpressionWithOptions(clause.where, options)}`);
  }
  return lines.join(options.newline);
}

function renderReturn(clause: ReturnClause, options: Required<RenderOptions>): string {
  const lines = [`RETURN ${clause.distinct ? "DISTINCT " : ""}${renderProjectionList(clause.items, options)}`];
  appendOrderSkipLimit(lines, clause.orderBy, clause.skip, clause.limit, options);
  return lines.join(options.newline);
}

function renderCall(clause: CallClause, options: Required<RenderOptions>): string {
  const args = (clause.arguments ?? []).map((arg) => renderExpressionWithOptions(arg, options)).join(", ");
  const lines = [`CALL ${clause.procedure}(${args})`];
  if (clause.yield && clause.yield.length > 0) {
    lines.push(`YIELD ${renderProjectionList(clause.yield, options)}`);
  }
  if (clause.where) {
    lines.push(`WHERE ${renderExpressionWithOptions(clause.where, options)}`);
  }
  return lines.join(options.newline);
}

function renderCreate(clause: CreateClause, options: Required<RenderOptions>): string {
  return `CREATE ${clause.patterns.map((pattern) => renderPath(pattern, options)).join(", ")}`;
}

function renderMerge(clause: MergeClause, options: Required<RenderOptions>): string {
  const lines = [`MERGE ${renderPath(clause.pattern, options)}`];
  if (clause.onCreate && clause.onCreate.length > 0) {
    lines.push(`ON CREATE SET ${clause.onCreate.map((item) => renderSetItem(item, options)).join(", ")}`);
  }
  if (clause.onMatch && clause.onMatch.length > 0) {
    lines.push(`ON MATCH SET ${clause.onMatch.map((item) => renderSetItem(item, options)).join(", ")}`);
  }
  return lines.join(options.newline);
}

function renderDelete(clause: DeleteClause, options: Required<RenderOptions>): string {
  const keyword = clause.detach ? "DETACH DELETE" : "DELETE";
  return `${keyword} ${clause.expressions.map((expr) => renderExpressionWithOptions(expr, options)).join(", ")}`;
}

function renderSet(clause: SetClause, options: Required<RenderOptions>): string {
  return `SET ${clause.items.map((item) => renderSetItem(item, options)).join(", ")}`;
}

function renderNode(node: NodePattern, options: Required<RenderOptions>): string {
  const variable = node.variable ? renderVariable(node.variable) : "";
  const labels = (node.labels ?? [])
    .map((label) => `:${cypherIdentifier(label, { alwaysEscape: options.alwaysEscapeSchemaIdentifiers })}`)
    .join("");
  const properties = renderProperties(node.properties, options);
  const where = node.where ? ` WHERE ${renderExpressionWithOptions(node.where, options)}` : "";
  return `(${variable}${labels}${properties}${where})`;
}

function renderRelationship(rel: RelationshipPattern, options: Required<RenderOptions>): string {
  const variable = rel.variable ? renderVariable(rel.variable) : "";
  const types = rel.types?.length
    ? `:${rel.types.map((type) => cypherIdentifier(type, { alwaysEscape: options.alwaysEscapeSchemaIdentifiers })).join("|")}`
    : "";
  const range = renderRange(rel);
  const properties = renderProperties(rel.properties, options);
  const where = rel.where ? ` WHERE ${renderExpressionWithOptions(rel.where, options)}` : "";
  const bracket = `[${variable}${types}${range}${properties}${where}]`;

  switch (rel.direction ?? "out") {
    case "in":
      return `<-${bracket}-`;
    case "undirected":
      return `-${bracket}-`;
    case "out":
      return `-${bracket}->`;
  }
}

function renderRange(rel: RelationshipPattern): string {
  if (rel.minHops === undefined && rel.maxHops === undefined) {
    return "";
  }
  const min = rel.minHops ?? "";
  const max = rel.maxHops ?? "";
  if (min === "" && max === "") {
    return "*";
  }
  if (rel.maxHops === undefined && rel.minHops !== undefined) {
    return `*${rel.minHops}`;
  }
  return `*${min}..${max}`;
}

function renderProperties(properties: Record<string, Expression> | undefined, options: Required<RenderOptions>): string {
  const entries = Object.entries(properties ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "";
  }
  return ` {${entries
    .map(
      ([key, value]) =>
        `${cypherIdentifier(key, { alwaysEscape: options.alwaysEscapeSchemaIdentifiers })}: ${renderExpressionWithOptions(
          value,
          options
        )}`
    )
    .join(", ")}}`;
}

function renderExpressionWithOptions(expression: Expression, options: Required<RenderOptions>): string {
  switch (expression.kind) {
    case "var":
      return renderVariable(expression.name);
    case "prop":
      return `${renderExpressionWithOptions(expression.object, options)}.${cypherIdentifier(expression.key, {
        alwaysEscape: options.alwaysEscapeSchemaIdentifiers
      })}`;
    case "param":
      return `$${renderParameterName(expression.name)}`;
    case "literal":
      return renderLiteral(expression.value);
    case "binary":
      return `(${renderExpressionWithOptions(expression.left, options)} ${expression.op} ${renderExpressionWithOptions(
        expression.right,
        options
      )})`;
    case "unary":
      return `(${expression.op} ${renderExpressionWithOptions(expression.expression, options)})`;
    case "function":
      return `${expression.name}(${expression.distinct ? "DISTINCT " : ""}${expression.arguments
        .map((arg) => renderExpressionWithOptions(arg, options))
        .join(", ")})`;
    case "list":
      return `[${expression.items.map((item) => renderExpressionWithOptions(item, options)).join(", ")}]`;
    case "map":
      return `{${Object.entries(expression.entries)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${cypherIdentifier(key)}: ${renderExpressionWithOptions(value, options)}`)
        .join(", ")}}`;
    case "case":
      return renderCase(expression, options);
    case "raw":
      return expression.cypher;
  }
}

function renderCase(
  expression: Extract<Expression, { kind: "case" }>,
  options: Required<RenderOptions>
): string {
  const head = expression.expression ? `CASE ${renderExpressionWithOptions(expression.expression, options)}` : "CASE";
  const branches = expression.cases
    .map(
      (branch) =>
        `WHEN ${renderExpressionWithOptions(branch.when, options)} THEN ${renderExpressionWithOptions(branch.then, options)}`
    )
    .join(" ");
  const otherwise = expression.else ? ` ELSE ${renderExpressionWithOptions(expression.else, options)}` : "";
  return `${head} ${branches}${otherwise} END`;
}

function renderProjectionList(
  items: ProjectionItem[],
  options: Required<RenderOptions>,
  includeExisting = false
): string {
  const rendered = items.map((item) => renderProjection(item, options));
  if (includeExisting) {
    return ["*", ...rendered].join(", ");
  }
  return rendered.length > 0 ? rendered.join(", ") : "*";
}

function renderProjection(item: ProjectionItem, options: Required<RenderOptions>): string {
  const expression = renderExpressionWithOptions(item.expression, options);
  return item.alias ? `${expression} AS ${renderVariable(item.alias)}` : expression;
}

function renderBinding(binding: Binding, options: Required<RenderOptions>): string {
  return `${renderVariable(binding.alias)} = ${renderExpressionWithOptions(binding.expression, options)}`;
}

function appendOrderSkipLimit(
  lines: string[],
  orderBy: OrderItem[] | undefined,
  skip: Expression | undefined,
  limit: Expression | undefined,
  options: Required<RenderOptions>
) {
  if (orderBy && orderBy.length > 0) {
    lines.push(`ORDER BY ${orderBy.map((item) => renderOrderItem(item, options)).join(", ")}`);
  }
  if (skip) {
    lines.push(`SKIP ${renderExpressionWithOptions(skip, options)}`);
  }
  if (limit) {
    lines.push(`LIMIT ${renderExpressionWithOptions(limit, options)}`);
  }
}

function renderOrderItem(item: OrderItem, options: Required<RenderOptions>): string {
  return `${renderExpressionWithOptions(item.expression, options)}${item.direction ? ` ${item.direction}` : ""}`;
}

function renderSetItem(item: SetItem, options: Required<RenderOptions>): string {
  return `${renderExpressionWithOptions(item.target, options)} ${item.operator ?? "="} ${renderExpressionWithOptions(
    item.value,
    options
  )}`;
}

function renderVariable(name: string): string {
  return cypherIdentifier(name, { alwaysEscape: !isBareIdentifier(name) });
}

function renderParameterName(name: string): string {
  return isBareIdentifier(name) ? name : cypherIdentifier(name);
}

function renderLiteral(value: JsonLiteral): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot render non-finite number literal: ${value}`);
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => renderLiteral(item)).join(", ")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${cypherIdentifier(key)}: ${renderLiteral(nested)}`)
    .join(", ")}}`;
}
