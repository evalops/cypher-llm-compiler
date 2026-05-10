import type {
  CypherQuery,
  CypherSchemaContract,
  NodePattern,
  PathContinuation,
  RelationshipDirection,
  RelationshipPattern,
  SchemaRelationship
} from "./ir.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import {
  canonicalLabel,
  canonicalRelationshipType,
  cypherIdentifier,
  normalizeSchema,
  type NormalizedSchema
} from "./schema.js";
import { validateQuery } from "./validate.js";

export interface RepairOptions {
  defaultLimit?: number;
  defaultMaxHops?: number;
}

export interface RepairSourcePosition {
  offset: number;
  line: number;
  character: number;
}

export interface RepairSourceSpan {
  start: RepairSourcePosition;
  end: RepairSourcePosition;
}

export interface RepairTextEdit {
  span: RepairSourceSpan;
  before: string;
  after: string;
}

export interface RepairAction {
  kind: "canonicalize-identifier" | "add-limit" | "fix-direction" | "bound-path" | "quote-raw-identifier";
  path: string;
  before: unknown;
  after: unknown;
  textEdits?: RepairTextEdit[];
}

export interface RepairResult {
  query: CypherQuery;
  diagnostics: Diagnostic[];
  applied: RepairAction[];
}

export interface RawCypherRepairResult {
  cypher: string;
  diagnostics: Diagnostic[];
  applied: RepairAction[];
}

export function repairQuery(
  query: CypherQuery,
  schemaInput: CypherSchemaContract | NormalizedSchema,
  options: RepairOptions = {}
): RepairResult {
  const schema = asNormalizedSchema(schemaInput);
  const repaired = cloneQuery(query);
  const applied: RepairAction[] = [];

  repaired.clauses.forEach((clause, clauseIndex) => {
    if ("patterns" in clause) {
      clause.patterns.forEach((pattern, patternIndex) => {
        repairPath(
          pattern.segments[0],
          pattern.segments.slice(1) as PathContinuation[],
          schema,
          applied,
          `/clauses/${clauseIndex}/patterns/${patternIndex}`,
          options
        );
      });
    }
    if (clause.kind === "merge") {
      repairPath(
        clause.pattern.segments[0],
        clause.pattern.segments.slice(1) as PathContinuation[],
        schema,
        applied,
        `/clauses/${clauseIndex}/pattern`,
        options
      );
    }
    if (clause.kind === "return" && !clause.limit && options.defaultLimit !== undefined) {
      clause.limit = { kind: "literal", value: options.defaultLimit };
      applied.push({
        kind: "add-limit",
        path: `/clauses/${clauseIndex}/limit`,
        before: undefined,
        after: options.defaultLimit
      });
    }
  });

  const validation = validateQuery(repaired, schema);
  return {
    query: repaired,
    diagnostics: validation.diagnostics,
    applied
  };
}

export function repairRawCypher(rawCypher: string, schemaInput: CypherSchemaContract | NormalizedSchema): RawCypherRepairResult {
  const schema = asNormalizedSchema(schemaInput);
  const diagnostics: Diagnostic[] = [];
  const applied: RepairAction[] = [];
  const rawTextEdits: RepairTextEdit[] = [];
  const claimedSpans = new Set<string>();
  let cypher = rawCypher;

  if (!/\b(MATCH|RETURN|WITH|CALL|CREATE|MERGE|UNWIND)\b/i.test(cypher)) {
    diagnostics.push(
      diagnostic({
        code: "no-cypher-output",
        severity: "error",
        message: "The model output does not look like a Cypher query.",
        suggestion: "Ask the model to return only Cypher or structured Cypher IR."
      })
    );
  }

  if (/\bBETWEEN\b/i.test(cypher)) {
    diagnostics.push(
      diagnostic({
        code: "sqlism-between",
        severity: "warning",
        message: "Cypher does not use SQL BETWEEN syntax.",
        suggestion: "Rewrite 'x BETWEEN a AND b' as 'x >= a AND x <= b'."
      })
    );
  }

  for (const relationship of schema.relationships) {
    const textEdits = claimTextEdits(identifierTextEdits(rawCypher, relationship.type), claimedSpans);
    if (textEdits.length > 0) {
      applied.push({
        kind: "quote-raw-identifier",
        path: `/relationships/${relationship.type}`,
        before: relationship.type,
        after: cypherIdentifier(relationship.type),
        textEdits
      });
      rawTextEdits.push(...textEdits);
    }
  }

  for (const node of schema.nodes) {
    const textEdits = claimTextEdits(identifierTextEdits(rawCypher, node.name), claimedSpans);
    if (textEdits.length > 0) {
      applied.push({
        kind: "quote-raw-identifier",
        path: `/nodes/${node.name}`,
        before: node.name,
        after: cypherIdentifier(node.name),
        textEdits
      });
      rawTextEdits.push(...textEdits);
    }
  }

  cypher = applyTextEdits(rawCypher, rawTextEdits);

  if (applied.length > 0) {
    diagnostics.push(
      diagnostic({
        code: "raw-identifier-quoted",
        severity: "info",
        message: "Known schema identifiers were backtick-escaped in raw Cypher.",
        repair: {
          kind: "escape-identifier",
          description: "Backtick-escape known schema identifiers."
        }
      })
    );
  }

  return { cypher, diagnostics, applied };
}

function repairPath(
  head: NodePattern,
  tail: PathContinuation[],
  schema: NormalizedSchema,
  applied: RepairAction[],
  path: string,
  options: RepairOptions
) {
  canonicalizeNode(head, schema, applied, `${path}/segments/0`);
  let previous = head;
  tail.forEach((segment, tailIndex) => {
    const segmentIndex = tailIndex + 1;
    canonicalizeRelationship(segment.rel, schema, applied, `${path}/segments/${segmentIndex}/rel`);
    canonicalizeNode(segment.node, schema, applied, `${path}/segments/${segmentIndex}/node`);
    repairDirection(segment.rel, previous, segment.node, schema, applied, `${path}/segments/${segmentIndex}/rel`);
    if (segment.rel.maxHops === null && options.defaultMaxHops !== undefined) {
      segment.rel.maxHops = options.defaultMaxHops;
      applied.push({
        kind: "bound-path",
        path: `${path}/segments/${segmentIndex}/rel/maxHops`,
        before: null,
        after: options.defaultMaxHops
      });
    }
    previous = segment.node;
  });
}

function canonicalizeNode(node: NodePattern, schema: NormalizedSchema, applied: RepairAction[], path: string) {
  if (!node.labels) {
    return;
  }
  node.labels = node.labels.map((label, index) => {
    const canonical = canonicalLabel(schema, label);
    if (canonical && canonical !== label) {
      applied.push({
        kind: "canonicalize-identifier",
        path: `${path}/labels/${index}`,
        before: label,
        after: canonical
      });
      return canonical;
    }
    return label;
  });
}

function canonicalizeRelationship(
  rel: RelationshipPattern,
  schema: NormalizedSchema,
  applied: RepairAction[],
  path: string
) {
  if (!rel.types) {
    return;
  }
  rel.types = rel.types.map((type, index) => {
    const canonical = canonicalRelationshipType(schema, type);
    if (canonical && canonical !== type) {
      applied.push({
        kind: "canonicalize-identifier",
        path: `${path}/types/${index}`,
        before: type,
        after: canonical
      });
      return canonical;
    }
    return type;
  });
}

function repairDirection(
  rel: RelationshipPattern,
  left: NodePattern,
  right: NodePattern,
  schema: NormalizedSchema,
  applied: RepairAction[],
  path: string
) {
  const type = rel.types?.[0];
  if (!type) {
    return;
  }
  const relationship = schema.relationshipByType.get(type);
  if (!relationship || relationship.directed === false) {
    return;
  }
  const current = rel.direction ?? "out";
  const leftLabels = (left.labels ?? []).map((label) => canonicalLabel(schema, label)).filter(isString);
  const rightLabels = (right.labels ?? []).map((label) => canonicalLabel(schema, label)).filter(isString);
  if (leftLabels.length === 0 || rightLabels.length === 0 || relationshipAllows(relationship, current, leftLabels, rightLabels)) {
    return;
  }
  const fixed = bestDirection(relationship, current, leftLabels, rightLabels);
  if (!fixed) {
    return;
  }
  rel.direction = fixed;
  applied.push({
    kind: "fix-direction",
    path: `${path}/direction`,
    before: current,
    after: fixed
  });
}

function bestDirection(
  relationship: SchemaRelationship,
  current: RelationshipDirection,
  leftLabels: string[],
  rightLabels: string[]
): RelationshipDirection | undefined {
  for (const candidate of ["out", "in"] as const) {
    if (candidate !== current && relationshipAllows(relationship, candidate, leftLabels, rightLabels)) {
      return candidate;
    }
  }
  return undefined;
}

function relationshipAllows(
  relationship: SchemaRelationship,
  direction: RelationshipDirection,
  leftLabels: string[],
  rightLabels: string[]
): boolean {
  const from = toArray(relationship.from);
  const to = toArray(relationship.to);
  if (direction === "out" || direction === "undirected") {
    return leftLabels.some((label) => from.includes(label)) && rightLabels.some((label) => to.includes(label));
  }
  return leftLabels.some((label) => to.includes(label)) && rightLabels.some((label) => from.includes(label));
}

function identifierTextEdits(input: string, identifier: string): RepairTextEdit[] {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    return [];
  }
  const escaped = escapeRegExp(identifier);
  const pattern = new RegExp(`(:|\\.)${escaped}(?=\\s|\\]|\\)|\\}|\\||,|$)`, "g");
  const replacement = cypherIdentifier(identifier);
  const edits: RepairTextEdit[] = [];

  for (const match of input.matchAll(pattern)) {
    const prefix = match[1] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    const end = start + identifier.length;
    edits.push({
      span: spanForOffsets(input, start, end),
      before: identifier,
      after: replacement
    });
  }

  return edits;
}

function claimTextEdits(edits: RepairTextEdit[], claimedSpans: Set<string>): RepairTextEdit[] {
  return edits.filter((edit) => {
    const key = `${edit.span.start.offset}:${edit.span.end.offset}`;
    if (claimedSpans.has(key)) {
      return false;
    }
    claimedSpans.add(key);
    return true;
  });
}

function applyTextEdits(input: string, edits: RepairTextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.span.start.offset - left.span.start.offset)
    .reduce((output, edit) => {
      return `${output.slice(0, edit.span.start.offset)}${edit.after}${output.slice(edit.span.end.offset)}`;
    }, input);
}

function spanForOffsets(input: string, start: number, end: number): RepairSourceSpan {
  return {
    start: positionAtOffset(input, start),
    end: positionAtOffset(input, end)
  };
}

function positionAtOffset(input: string, offset: number): RepairSourcePosition {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (input[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return {
    offset,
    line,
    character: offset - lineStart
  };
}

function cloneQuery(query: CypherQuery): CypherQuery {
  return JSON.parse(JSON.stringify(query)) as CypherQuery;
}

function asNormalizedSchema(schema: CypherSchemaContract | NormalizedSchema): NormalizedSchema {
  return "nodeByName" in schema ? schema : normalizeSchema(schema);
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
