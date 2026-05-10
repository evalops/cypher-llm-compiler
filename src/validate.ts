import type {
  Binding,
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
  resolveProcedure,
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
  options: Required<ValidationOptions>,
  basePath = "/clauses"
) {
  const path = `${basePath}/${index}`;
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
      validateMatch(clause, path, scope, schema, diagnostics, options);
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
      validateWith(clause, path, scope, schema, diagnostics, options);
      return;
    case "return":
      validateReturn(clause, path, scope, schema, diagnostics, options);
      return;
    case "call":
      validateCall(clause, path, scope, schema, diagnostics, options);
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
  path: string,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  clause.patterns.forEach((pattern, patternIndex) =>
    validatePath(pattern, scope, schema, diagnostics, `${path}/patterns/${patternIndex}`, options)
  );
  if (clause.where) {
    if (containsAggregateFunction(clause.where)) {
      diagnostics.push(
        diagnostic({
          code: "aggregate-in-match-where",
          severity: "error",
          message: "MATCH WHERE cannot contain aggregate functions because it is evaluated before aggregation.",
          path: `${path}/where`,
          suggestion: "Move the aggregate into a WITH or RETURN projection, alias it, then filter on that alias."
        })
      );
    }
    validateExpression(clause.where, scope, schema, diagnostics, `${path}/where`, options);
  }
}

function validateCall(
  clause: CallClause,
  path: string,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  if (clause.subquery) {
    validateSubqueryCall(clause, path, scope, schema, diagnostics, options);
    return;
  }
  validateProcedureCall(clause, path, scope, schema, diagnostics, options);
}

function validateProcedureCall(
  clause: CallClause,
  path: string,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  if (!clause.procedure) {
    diagnostics.push(
      diagnostic({
        code: "missing-procedure",
        severity: "error",
        message: "CALL procedure clause requires a procedure name.",
        path,
        suggestion: "Set procedure or use subquery for CALL { ... }."
      })
    );
    return;
  }

  const procedure = resolveProcedure(schema, clause.procedure);
  if (schema.procedures.size > 0 && !procedure) {
    diagnostics.push(
      diagnostic({
        code: "unknown-procedure",
        severity: "error",
        message: `Procedure '${clause.procedure}' is not declared in the schema contract.`,
        path: `${path}/procedure`,
        suggestion: "Use a declared procedure or add procedure metadata to schema.procedures."
      })
    );
  }

  for (const [argumentIndex, argument] of (clause.arguments ?? []).entries()) {
    validateExpression(argument, scope, schema, diagnostics, `${path}/arguments/${argumentIndex}`, options);
  }

  for (const [yieldIndex, projection] of (clause.yield ?? []).entries()) {
    const yieldedName = variableName(projection.expression);
    if (procedure?.yields && (!yieldedName || !(yieldedName in procedure.yields))) {
      diagnostics.push(
        diagnostic({
          code: "unknown-procedure-yield",
          severity: "error",
          message: yieldedName
            ? `Procedure '${clause.procedure}' does not yield '${yieldedName}'.`
            : `Procedure '${clause.procedure}' YIELD item must be a yielded variable.`,
          path: `${path}/yield/${yieldIndex}`,
          suggestion: "Use a YIELD variable declared in schema.procedures for this procedure."
        })
      );
    }
    const alias = projection.alias ?? yieldedName;
    if (alias) {
      scope.set(alias, { kind: "unknown" });
    }
  }

  if (clause.where) {
    validateExpression(clause.where, scope, schema, diagnostics, `${path}/where`, options);
  }
}

function validateSubqueryCall(
  clause: CallClause,
  path: string,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  const subScope: Scope = new Map();
  for (const [importIndex, name] of (clause.import ?? []).entries()) {
    const binding = scope.get(name);
    if (!binding) {
      diagnostics.push(
        diagnostic({
          code: "subquery-import-undefined",
          severity: "error",
          message: `Subquery imports variable '${name}', but it is not in the outer scope.`,
          path: `${path}/import/${importIndex}`,
          suggestion: "Import only variables produced before CALL, or move the CALL after the variable is introduced."
        })
      );
      continue;
    }
    subScope.set(name, binding);
  }

  clause.subquery?.clauses.forEach((subClause, subIndex) => {
    validateClause(subClause, subIndex, subScope, schema, diagnostics, options, `${path}/subquery/clauses`);
  });

  const exports = exportedSubqueryBindings(clause.subquery, subScope);
  if (exports.size === 0) {
    diagnostics.push(
      diagnostic({
        code: "subquery-missing-return",
        severity: "warning",
        message: "CALL subquery does not export variables with a final RETURN clause.",
        path: `${path}/subquery`,
        suggestion: "End the subquery with RETURN aliases for values needed by following clauses."
      })
    );
  }
  for (const [name, binding] of exports) {
    if (scope.has(name)) {
      diagnostics.push(
        diagnostic({
          code: "subquery-variable-shadowing",
          severity: "error",
          message: `Subquery returns '${name}', which is already bound in the outer scope.`,
          path: `${path}/subquery`,
          suggestion: "Return the value with a distinct alias."
        })
      );
      continue;
    }
    scope.set(name, binding);
  }
}

function validateWith(
  clause: WithClause,
  path: string,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  clause.items.forEach((item, itemIndex) =>
    validateProjectionItem(item, scope, schema, diagnostics, `${path}/items/${itemIndex}`, options)
  );
  const aggregation = projectionAggregationInfo(clause.items);

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
    validateAggregationPredicate(clause.where, aggregation, diagnostics, `${path}/where`);
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
  path: string,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  options: Required<ValidationOptions>
) {
  clause.items.forEach((item, itemIndex) =>
    validateProjectionItem(item, scope, schema, diagnostics, `${path}/items/${itemIndex}`, options)
  );
  const aggregation = projectionAggregationInfo(clause.items);
  clause.orderBy?.forEach((item, itemIndex) => {
    validateAggregationPredicate(item.expression, aggregation, diagnostics, `${path}/orderBy/${itemIndex}`);
    validateExpression(item.expression, scope, schema, diagnostics, `${path}/orderBy/${itemIndex}`, options);
  });
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
  if (containsAggregateFunction(item.expression) && !item.alias) {
    diagnostics.push(
      diagnostic({
        code: "aggregate-alias-required",
        severity: "error",
        message: "Aggregate projections should be aliased before later clauses can use them safely.",
        path,
        suggestion: "Add an alias such as AS countValue and reference that alias in following WITH/RETURN/WHERE clauses."
      })
    );
  }
  if (hasAmbiguousAggregation(item.expression)) {
    diagnostics.push(
      diagnostic({
        code: "ambiguous-aggregation-expression",
        severity: "error",
        message: "Projection expression mixes aggregate and non-aggregate variable references.",
        path: `${path}/expression`,
        suggestion: "Project grouping keys and aggregate values as separate WITH/RETURN items, then combine aliases later."
      })
    );
  }
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

const AGGREGATE_FUNCTIONS = new Set([
  "avg",
  "collect",
  "count",
  "max",
  "min",
  "percentilecont",
  "percentiledisc",
  "stdev",
  "stdevp",
  "sum"
]);

interface AggregationShape {
  hasAggregate: boolean;
  hasVariableReference: boolean;
  ambiguous: boolean;
}

function containsAggregateFunction(expression: Expression): boolean {
  return aggregationShape(expression).hasAggregate;
}

function hasAmbiguousAggregation(expression: Expression): boolean {
  return aggregationShape(expression).ambiguous;
}

interface ProjectionAggregationInfo {
  hasAggregate: boolean;
}

function projectionAggregationInfo(items: ProjectionItem[]): ProjectionAggregationInfo {
  return {
    hasAggregate: items.some((item) => containsAggregateFunction(item.expression))
  };
}

function validateAggregationPredicate(
  expression: Expression,
  aggregation: ProjectionAggregationInfo,
  diagnostics: Diagnostic[],
  path: string
) {
  if (!aggregation.hasAggregate || !containsAggregateFunction(expression)) {
    return;
  }
  diagnostics.push(
    diagnostic({
      code: "invalid-aggregation",
      severity: "error",
      message: "Aggregation predicates should reference projected aggregate aliases, not repeat aggregate calls.",
      path,
      suggestion: "Alias the aggregate in WITH/RETURN, then filter or order by that alias."
    })
  );
}

function exportedSubqueryBindings(query: CypherQuery | undefined, scope: Scope): Scope {
  const exported: Scope = new Map();
  const finalClause = query?.clauses.at(-1);
  if (!finalClause || finalClause.kind !== "return") {
    return exported;
  }
  for (const item of finalClause.items) {
    const alias = item.alias ?? variableName(item.expression);
    if (alias) {
      exported.set(alias, inferExpressionBinding(item.expression, scope));
    }
  }
  return exported;
}

function aggregationShape(expression: Expression): AggregationShape {
  switch (expression.kind) {
    case "var":
    case "prop":
      return { hasAggregate: false, hasVariableReference: true, ambiguous: false };
    case "param":
    case "literal":
    case "raw":
      return { hasAggregate: false, hasVariableReference: false, ambiguous: false };
    case "function":
      if (isAggregateFunction(expression.name)) {
        return { hasAggregate: true, hasVariableReference: false, ambiguous: false };
      }
      return mergeAggregationShapes(expression.arguments.map(aggregationShape));
    case "binary":
      return mergeAggregationShapes([aggregationShape(expression.left), aggregationShape(expression.right)]);
    case "unary":
      return aggregationShape(expression.expression);
    case "list":
      return mergeAggregationShapes(expression.items.map(aggregationShape));
    case "map":
      return mergeAggregationShapes(Object.values(expression.entries).map(aggregationShape));
    case "case":
      return mergeAggregationShapes([
        ...(expression.expression ? [aggregationShape(expression.expression)] : []),
        ...expression.cases.flatMap((branch) => [aggregationShape(branch.when), aggregationShape(branch.then)]),
        ...(expression.else ? [aggregationShape(expression.else)] : [])
      ]);
  }
}

function mergeAggregationShapes(shapes: AggregationShape[]): AggregationShape {
  const hasAggregate = shapes.some((shape) => shape.hasAggregate);
  const hasVariableReference = shapes.some((shape) => shape.hasVariableReference);
  return {
    hasAggregate,
    hasVariableReference,
    ambiguous: shapes.some((shape) => shape.ambiguous) || (hasAggregate && hasVariableReference)
  };
}

function isAggregateFunction(name: string): boolean {
  return AGGREGATE_FUNCTIONS.has(name.replaceAll(".", "").toLowerCase());
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
