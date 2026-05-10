import type {
  Binding,
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
  SchemaRelationship,
  WithClause
} from "./ir.js";
import { diagnostic, hasErrors, type Diagnostic } from "./diagnostics.js";
import {
  canonicalLabel,
  canonicalRelationshipType,
  normalizeSchema,
  resolveLabel,
  resolveProperty,
  resolveRelationshipType,
  type NormalizedSchema
} from "./schema.js";

export interface ValidationOptions {
  requireKnownParameters?: boolean;
  warnOnMissingLimit?: boolean;
  warnOnRawCypher?: boolean;
  disallowWrites?: boolean;
}

export interface ValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

interface VariableBinding {
  kind: "node" | "relationship" | "path" | "unknown";
  labels?: string[];
  relationshipTypes?: string[];
}

type Scope = Map<string, VariableBinding>;

const DEFAULT_OPTIONS: Required<ValidationOptions> = {
  requireKnownParameters: true,
  warnOnMissingLimit: true,
  warnOnRawCypher: true,
  disallowWrites: true
};

export function validateQuery(
  query: CypherQuery,
  schemaInput: CypherSchemaContract | NormalizedSchema,
  options: ValidationOptions = {}
): ValidationResult {
  const schema = asNormalizedSchema(schemaInput);
  const opts = {
    ...DEFAULT_OPTIONS,
    disallowWrites: schema.original.disallowWritesByDefault ?? DEFAULT_OPTIONS.disallowWrites,
    ...options
  };
  const diagnostics: Diagnostic[] = [];
  const scope: Scope = new Map();

  query.clauses.forEach((clause, index) => {
    validateClause(clause, index, scope, schema, diagnostics, opts);
  });

  if (query.profile === "llm-safe-readonly" && !query.clauses.some((clause) => clause.kind === "return")) {
    diagnostics.push(
      diagnostic({
        code: "missing-return",
        severity: "warning",
        message: "Readonly LLM-safe queries should end with an explicit RETURN clause.",
        suggestion: "Add a RETURN projection for the values the caller needs."
      })
    );
  }

  return {
    ok: !hasErrors(diagnostics),
    diagnostics
  };
}

export function isWriteClause(clause: Clause): boolean {
  return clause.kind === "create" || clause.kind === "merge" || clause.kind === "delete" || clause.kind === "set";
}

function validateClause(
  clause: Clause,
  index: number,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  const path = `/clauses/${index}`;
  if (isWriteClause(clause) && options.disallowWrites) {
    diagnostics.push(
      diagnostic({
        code: "write-requires-approval",
        severity: "error",
        message: `Clause '${clause.kind}' mutates the graph and is not allowed in readonly mode.`,
        path,
        suggestion: "Route this query through an approval-required execution mode."
      })
    );
  }

  switch (clause.kind) {
    case "match":
      validateMatch(clause, index, scope, schema, diagnostics, options);
      return;
    case "unwind":
      validateExpression(clause.expression, scope, schema, diagnostics, `${path}/expression`, options);
      scope.set(clause.alias, { kind: "unknown" });
      return;
    case "let":
      for (const [bindingIndex, binding] of clause.bindings.entries()) {
        validateBinding(binding, scope, schema, diagnostics, `${path}/bindings/${bindingIndex}`, options);
      }
      for (const binding of clause.bindings) {
        scope.set(binding.alias, { kind: "unknown" });
      }
      return;
    case "with":
      validateWith(clause, index, scope, schema, diagnostics, options);
      return;
    case "return":
      validateReturn(clause, index, scope, schema, diagnostics, options);
      return;
    case "call":
      for (const [argumentIndex, argument] of (clause.arguments ?? []).entries()) {
        validateExpression(argument, scope, schema, diagnostics, `${path}/arguments/${argumentIndex}`, options);
      }
      for (const projection of clause.yield ?? []) {
        const alias = projection.alias ?? variableName(projection.expression);
        if (alias) {
          scope.set(alias, { kind: "unknown" });
        }
      }
      if (clause.where) {
        validateExpression(clause.where, scope, schema, diagnostics, `${path}/where`, options);
      }
      return;
    case "create":
      clause.patterns.forEach((pattern, patternIndex) =>
        validatePath(pattern, scope, schema, diagnostics, `${path}/patterns/${patternIndex}`, options)
      );
      return;
    case "merge":
      validatePath(clause.pattern, scope, schema, diagnostics, `${path}/pattern`, options);
      for (const item of [...(clause.onCreate ?? []), ...(clause.onMatch ?? [])]) {
        validateExpression(item.target, scope, schema, diagnostics, `${path}/set/target`, options);
        validateExpression(item.value, scope, schema, diagnostics, `${path}/set/value`, options);
      }
      return;
    case "delete":
      clause.expressions.forEach((expression, expressionIndex) =>
        validateExpression(expression, scope, schema, diagnostics, `${path}/expressions/${expressionIndex}`, options)
      );
      return;
    case "set":
      clause.items.forEach((item, itemIndex) => {
        validateExpression(item.target, scope, schema, diagnostics, `${path}/items/${itemIndex}/target`, options);
        validateExpression(item.value, scope, schema, diagnostics, `${path}/items/${itemIndex}/value`, options);
      });
      return;
    case "raw":
      if (options.warnOnRawCypher) {
        diagnostics.push(
          diagnostic({
            code: "raw-cypher-escape-hatch",
            severity: "warning",
            message: "Raw Cypher bypasses schema-aware IR validation.",
            path,
            suggestion: "Prefer structured IR unless this is a deliberate compatibility escape hatch."
          })
        );
      }
      return;
  }
}

function validateMatch(
  clause: MatchClause,
  index: number,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  clause.patterns.forEach((pattern, patternIndex) =>
    validatePath(pattern, scope, schema, diagnostics, `/clauses/${index}/patterns/${patternIndex}`, options)
  );
  if (clause.where) {
    validateExpression(clause.where, scope, schema, diagnostics, `/clauses/${index}/where`, options);
  }
}

function validateWith(
  clause: WithClause,
  index: number,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  const path = `/clauses/${index}`;
  clause.items.forEach((item, itemIndex) =>
    validateProjectionItem(item, scope, schema, diagnostics, `${path}/items/${itemIndex}`, options)
  );

  const nextScope: Scope = clause.includeExisting ? new Map(scope) : new Map();
  for (const item of clause.items) {
    const alias = item.alias ?? variableName(item.expression);
    if (alias) {
      nextScope.set(alias, inferExpressionBinding(item.expression, scope));
    }
  }
  scope.clear();
  for (const [name, binding] of nextScope) {
    scope.set(name, binding);
  }

  if (clause.where) {
    validateExpression(clause.where, scope, schema, diagnostics, `${path}/where`, options);
  }
  clause.orderBy?.forEach((item, itemIndex) =>
    validateExpression(item.expression, scope, schema, diagnostics, `${path}/orderBy/${itemIndex}`, options)
  );
  if (clause.skip) {
    validateExpression(clause.skip, scope, schema, diagnostics, `${path}/skip`, options);
  }
  if (clause.limit) {
    validateExpression(clause.limit, scope, schema, diagnostics, `${path}/limit`, options);
  }
}

function validateReturn(
  clause: ReturnClause,
  index: number,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  const path = `/clauses/${index}`;
  clause.items.forEach((item, itemIndex) =>
    validateProjectionItem(item, scope, schema, diagnostics, `${path}/items/${itemIndex}`, options)
  );
  clause.orderBy?.forEach((item, itemIndex) =>
    validateExpression(item.expression, scope, schema, diagnostics, `${path}/orderBy/${itemIndex}`, options)
  );
  if (clause.skip) {
    validateExpression(clause.skip, scope, schema, diagnostics, `${path}/skip`, options);
  }
  if (clause.limit) {
    validateExpression(clause.limit, scope, schema, diagnostics, `${path}/limit`, options);
  } else if (options.warnOnMissingLimit) {
    diagnostics.push(
      diagnostic({
        code: "missing-limit",
        severity: "warning",
        message: "RETURN has no LIMIT in an LLM-safe read profile.",
        path,
        suggestion: "Add a bounded LIMIT or let repairQuery add the configured default.",
        repair: {
          kind: "add-limit",
          description: "Add a default LIMIT to the RETURN clause."
        }
      })
    );
  }
}

function validateBinding(
  binding: Binding,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: Required<ValidationOptions>
) {
  validateExpression(binding.expression, scope, schema, diagnostics, `${path}/expression`, options);
}

function validateProjectionItem(
  item: ProjectionItem,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: Required<ValidationOptions>
) {
  validateExpression(item.expression, scope, schema, diagnostics, `${path}/expression`, options);
}

function validatePath(
  pattern: PathPattern,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: Required<ValidationOptions>
) {
  if (pattern.name) {
    scope.set(pattern.name, { kind: "path" });
  }

  const [head, ...tail] = pattern.segments;
  validateNode(head, scope, schema, diagnostics, `${path}/segments/0`, options);
  let previous = head;
  tail.forEach((segment, tailIndex) => {
    const segmentIndex = tailIndex + 1;
    validateRelationship(segment.rel, previous, segment.node, scope, schema, diagnostics, `${path}/segments/${segmentIndex}/rel`, options);
    validateNode(segment.node, scope, schema, diagnostics, `${path}/segments/${segmentIndex}/node`, options);
    previous = segment.node;
  });
}

function validateNode(
  node: NodePattern,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: Required<ValidationOptions>
) {
  const labels: string[] = [];
  for (const [labelIndex, label] of (node.labels ?? []).entries()) {
    const resolved = resolveLabel(schema, label);
    if (!resolved) {
      diagnostics.push(
        diagnostic({
          code: "unknown-label",
          severity: "error",
          message: `Label '${label}' does not exist in the schema contract.`,
          path: `${path}/labels/${labelIndex}`,
          suggestion: "Use a declared label or add the label to the schema contract."
        })
      );
      continue;
    }
    labels.push(resolved.name);
  }

  validateProperties("node", labels[0], node.properties, scope, schema, diagnostics, `${path}/properties`, options);
  if (node.where) {
    validateExpression(node.where, scope, schema, diagnostics, `${path}/where`, options);
  }
  if (node.variable) {
    scope.set(node.variable, { kind: "node", labels });
  }
}

function validateRelationship(
  rel: RelationshipPattern,
  left: NodePattern,
  right: NodePattern,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: Required<ValidationOptions>
) {
  const types: string[] = [];
  for (const [typeIndex, type] of (rel.types ?? []).entries()) {
    const resolved = resolveRelationshipType(schema, type);
    if (!resolved) {
      diagnostics.push(
        diagnostic({
          code: "unknown-relationship-type",
          severity: "error",
          message: `Relationship type '${type}' does not exist in the schema contract.`,
          path: `${path}/types/${typeIndex}`,
          suggestion: "Use a declared relationship type or add it to the schema contract."
        })
      );
      continue;
    }
    types.push(resolved.type);
    validateDirection(resolved, rel.direction ?? "out", left, right, schema, diagnostics, path);
  }

  if (rel.maxHops === null) {
    diagnostics.push(
      diagnostic({
        code: "unbounded-variable-length-path",
        severity: "warning",
        message: "Variable-length relationship has no maximum hop count.",
        path,
        suggestion: "Set maxHops to a small explicit number for LLM-safe execution.",
        repair: {
          kind: "bound-path",
          description: "Add a maximum hop count."
        }
      })
    );
  }

  validateProperties("relationship", types[0], rel.properties, scope, schema, diagnostics, `${path}/properties`, options);
  if (rel.where) {
    validateExpression(rel.where, scope, schema, diagnostics, `${path}/where`, options);
  }
  if (rel.variable) {
    scope.set(rel.variable, { kind: "relationship", relationshipTypes: types });
  }
}

function validateDirection(
  relationship: SchemaRelationship,
  direction: RelationshipDirection,
  left: NodePattern,
  right: NodePattern,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string
) {
  if (relationship.directed === false) {
    return;
  }
  const leftLabels = (left.labels ?? []).map((label) => canonicalLabel(schema, label)).filter(isString);
  const rightLabels = (right.labels ?? []).map((label) => canonicalLabel(schema, label)).filter(isString);
  if (leftLabels.length === 0 || rightLabels.length === 0) {
    return;
  }

  const allowed = relationshipAllows(relationship, direction, leftLabels, rightLabels);
  if (allowed) {
    return;
  }

  const repairDirection =
    direction !== "out" && relationshipAllows(relationship, "out", leftLabels, rightLabels)
      ? "out"
      : direction !== "in" && relationshipAllows(relationship, "in", leftLabels, rightLabels)
        ? "in"
        : undefined;

  diagnostics.push(
    diagnostic({
      code: "relationship-direction-mismatch",
      severity: "warning",
      message: `Relationship '${relationship.type}' direction does not match declared endpoints.`,
      path,
      suggestion: repairDirection
        ? `Use direction '${repairDirection}' for this pattern.`
        : "Check the endpoint labels or relationship type.",
      ...(repairDirection
        ? {
            repair: {
              kind: "fix-direction" as const,
              description: `Change direction to '${repairDirection}'.`,
              replacement: repairDirection
            }
          }
        : {})
    })
  );
}

function relationshipAllows(
  relationship: SchemaRelationship,
  direction: RelationshipDirection,
  leftLabels: string[],
  rightLabels: string[]
): boolean {
  const from = toArray(relationship.from);
  const to = toArray(relationship.to);
  if (direction === "undirected") {
    return endpointMatch(leftLabels, from) && endpointMatch(rightLabels, to);
  }
  if (direction === "out") {
    return endpointMatch(leftLabels, from) && endpointMatch(rightLabels, to);
  }
  return endpointMatch(leftLabels, to) && endpointMatch(rightLabels, from);
}

function validateProperties(
  ownerKind: "node" | "relationship",
  ownerName: string | undefined,
  properties: Record<string, Expression> | undefined,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: Required<ValidationOptions>
) {
  for (const [propertyName, expression] of Object.entries(properties ?? {})) {
    if (ownerName && !resolveProperty(schema, ownerKind, ownerName, propertyName)) {
      diagnostics.push(
        diagnostic({
          code: "unknown-property",
          severity: "warning",
          message: `Property '${propertyName}' is not declared on ${ownerKind} '${ownerName}'.`,
          path: `${path}/${propertyName}`,
          suggestion: "Use a declared property or update the schema contract."
        })
      );
    }
    validateExpression(expression, scope, schema, diagnostics, `${path}/${propertyName}`, options);
  }
}

function validateExpression(
  expression: Expression,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: Required<ValidationOptions>
) {
  switch (expression.kind) {
    case "var":
      if (!scope.has(expression.name)) {
        diagnostics.push(
          diagnostic({
            code: "undefined-variable",
            severity: "error",
            message: `Variable '${expression.name}' is not in scope.`,
            path,
            suggestion: "Introduce the variable in MATCH/UNWIND/LET/WITH or project it through WITH.",
            repair: {
              kind: "restore-scope",
              description: "Project the variable through the preceding WITH clause or rename this reference."
            }
          })
        );
      }
      return;
    case "prop":
      validatePropertyExpression(expression, scope, schema, diagnostics, path, options);
      return;
    case "param":
      if (options.requireKnownParameters && !schema.parameters.has(expression.name)) {
        diagnostics.push(
          diagnostic({
            code: "unknown-parameter",
            severity: "error",
            message: `Parameter '$${expression.name}' is not declared in the schema contract.`,
            path,
            suggestion: "Declare the parameter type in schema.parameters.",
            repair: {
              kind: "declare-parameter",
              description: `Declare parameter '${expression.name}'.`
            }
          })
        );
      }
      return;
    case "literal":
      return;
    case "binary":
      validateExpression(expression.left, scope, schema, diagnostics, `${path}/left`, options);
      validateExpression(expression.right, scope, schema, diagnostics, `${path}/right`, options);
      return;
    case "unary":
      validateExpression(expression.expression, scope, schema, diagnostics, `${path}/expression`, options);
      return;
    case "function":
      expression.arguments.forEach((argument, index) =>
        validateExpression(argument, scope, schema, diagnostics, `${path}/arguments/${index}`, options)
      );
      return;
    case "list":
      expression.items.forEach((item, index) =>
        validateExpression(item, scope, schema, diagnostics, `${path}/items/${index}`, options)
      );
      return;
    case "map":
      for (const [key, value] of Object.entries(expression.entries)) {
        validateExpression(value, scope, schema, diagnostics, `${path}/entries/${key}`, options);
      }
      return;
    case "case":
      if (expression.expression) {
        validateExpression(expression.expression, scope, schema, diagnostics, `${path}/expression`, options);
      }
      expression.cases.forEach((branch, index) => {
        validateExpression(branch.when, scope, schema, diagnostics, `${path}/cases/${index}/when`, options);
        validateExpression(branch.then, scope, schema, diagnostics, `${path}/cases/${index}/then`, options);
      });
      if (expression.else) {
        validateExpression(expression.else, scope, schema, diagnostics, `${path}/else`, options);
      }
      return;
    case "raw":
      if (options.warnOnRawCypher) {
        diagnostics.push(
          diagnostic({
            code: "raw-expression-escape-hatch",
            severity: "warning",
            message: "Raw Cypher expression bypasses schema-aware expression validation.",
            path,
            suggestion: "Use a structured expression node when possible."
          })
        );
      }
      return;
  }
}

function validatePropertyExpression(
  expression: Extract<Expression, { kind: "prop" }>,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: Required<ValidationOptions>
) {
  validateExpression(expression.object, scope, schema, diagnostics, `${path}/object`, options);
  if (expression.object.kind !== "var") {
    return;
  }
  const binding = scope.get(expression.object.name);
  if (!binding) {
    return;
  }
  if (binding.kind === "node") {
    const owner = binding.labels?.[0];
    if (owner && !resolveProperty(schema, "node", owner, expression.key)) {
      diagnostics.push(
        diagnostic({
          code: "unknown-property",
          severity: "warning",
          message: `Property '${expression.key}' is not declared on node '${owner}'.`,
          path,
          suggestion: "Use a declared property or update the schema contract."
        })
      );
    }
  }
  if (binding.kind === "relationship") {
    const owner = binding.relationshipTypes?.[0];
    if (owner && !resolveProperty(schema, "relationship", owner, expression.key)) {
      diagnostics.push(
        diagnostic({
          code: "unknown-property",
          severity: "warning",
          message: `Property '${expression.key}' is not declared on relationship '${owner}'.`,
          path,
          suggestion: "Use a declared property or update the schema contract."
        })
      );
    }
  }
}

function variableName(expression: Expression): string | undefined {
  return expression.kind === "var" ? expression.name : undefined;
}

function inferExpressionBinding(expression: Expression, scope: Scope): VariableBinding {
  if (expression.kind === "var") {
    return scope.get(expression.name) ?? { kind: "unknown" };
  }
  return { kind: "unknown" };
}

function endpointMatch(labels: string[], allowed: string[]): boolean {
  return labels.some((label) => allowed.includes(label));
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function asNormalizedSchema(schema: CypherSchemaContract | NormalizedSchema): NormalizedSchema {
  return "nodeByName" in schema ? schema : normalizeSchema(schema);
}
