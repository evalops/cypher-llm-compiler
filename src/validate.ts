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
  SchemaFunction,
  SchemaParameter,
  SchemaProcedure,
  SchemaProperty,
  SchemaRelationship,
  WithClause
} from "./ir.js";
import { getDialectProfile, type DialectProfile, type DialectProfileId } from "./dialects.js";
import { diagnostic, hasErrors, type Diagnostic } from "./diagnostics.js";
import {
  canonicalLabel,
  canonicalRelationshipType,
  normalizeSchema,
  resolveLabel,
  resolveFunction,
  resolveProperty,
  resolveProcedure,
  resolveRelationshipType,
  type NormalizedSchema
} from "./schema.js";

export interface ValidationOptions {
  dialect?: DialectProfileId;
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
  valueType?: string | undefined;
}

type Scope = Map<string, VariableBinding>;
type InternalValidationOptions = Required<Omit<ValidationOptions, "dialect">>;

const DEFAULT_OPTIONS: InternalValidationOptions = {
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
  const dialect = dialectProfileFor(options.dialect ?? schema.dialect);

  query.clauses.forEach((clause, index) => {
    validateClause(clause, index, scope, schema, diagnostics, opts, dialect);
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
  options: InternalValidationOptions,
  dialect: DialectProfile,
  basePath = "/clauses"
) {
  const path = `${basePath}/${index}`;
  validateDialectClause(clause, path, dialect, diagnostics);
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
      validateMatch(clause, path, scope, schema, diagnostics, options, dialect);
      return;
    case "unwind":
      validateExpression(clause.expression, scope, schema, diagnostics, `${path}/expression`, options);
      scope.set(clause.alias, { kind: "unknown", valueType: listElementType(inferExpressionType(clause.expression, scope, schema)) });
      return;
    case "let":
      for (const [bindingIndex, binding] of clause.bindings.entries()) {
        validateBinding(binding, scope, schema, diagnostics, `${path}/bindings/${bindingIndex}`, options);
      }
      for (const binding of clause.bindings) {
        scope.set(binding.alias, { kind: "unknown", valueType: inferExpressionType(binding.expression, scope, schema) });
      }
      return;
    case "with":
      validateWith(clause, path, scope, schema, diagnostics, options);
      return;
    case "return":
      validateReturn(clause, path, scope, schema, diagnostics, options);
      return;
    case "call":
      validateCall(clause, path, scope, schema, diagnostics, options, dialect);
      return;
    case "create":
      clause.patterns.forEach((pattern, patternIndex) =>
        validatePath(pattern, scope, schema, diagnostics, `${path}/patterns/${patternIndex}`, options, dialect)
      );
      return;
    case "merge":
      validatePath(clause.pattern, scope, schema, diagnostics, `${path}/pattern`, options, dialect);
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
  options: InternalValidationOptions,
  dialect: DialectProfile
) {
  clause.patterns.forEach((pattern, patternIndex) =>
    validatePath(pattern, scope, schema, diagnostics, `${path}/patterns/${patternIndex}`, options, dialect)
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
  options: InternalValidationOptions,
  dialect: DialectProfile
) {
  if (clause.subquery) {
    validateSubqueryCall(clause, path, scope, schema, diagnostics, options, dialect);
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
  options: InternalValidationOptions
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
  if (procedure?.arguments) {
    validateCallableArguments(
      "procedure",
      clause.procedure,
      procedure.arguments,
      clause.arguments ?? [],
      scope,
      schema,
      diagnostics,
      `${path}/arguments`
    );
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
      scope.set(alias, { kind: "unknown", valueType: yieldedName ? declaredType(procedure?.yields?.[yieldedName]) : undefined });
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
  options: InternalValidationOptions,
  dialect: DialectProfile
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
    validateClause(subClause, subIndex, subScope, schema, diagnostics, options, dialect, `${path}/subquery/clauses`);
  });

  const exports = exportedSubqueryBindings(clause.subquery, subScope, schema);
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
  options: InternalValidationOptions
) {
  clause.items.forEach((item, itemIndex) =>
    validateProjectionItem(item, scope, schema, diagnostics, `${path}/items/${itemIndex}`, options)
  );
  const aggregation = projectionAggregationInfo(clause.items);

  const nextScope: Scope = clause.includeExisting ? new Map(scope) : new Map();
  for (const item of clause.items) {
    const alias = item.alias ?? variableName(item.expression);
    if (alias) {
      nextScope.set(alias, inferExpressionBinding(item.expression, scope, schema));
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
  options: InternalValidationOptions
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
  options: InternalValidationOptions
) {
  validateExpression(binding.expression, scope, schema, diagnostics, `${path}/expression`, options);
}

function validateProjectionItem(
  item: ProjectionItem,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: InternalValidationOptions
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
  options: InternalValidationOptions,
  dialect: DialectProfile
) {
  if (pattern.name) {
    scope.set(pattern.name, { kind: "path", valueType: "PATH" });
  }
  validateDialectPath(pattern, path, dialect, diagnostics);

  const [head, ...tail] = pattern.segments;
  validateNode(head, scope, schema, diagnostics, `${path}/segments/0`, options);
  let previous = head;
  tail.forEach((segment, tailIndex) => {
    const segmentIndex = tailIndex + 1;
    validateRelationship(segment.rel, previous, segment.node, scope, schema, diagnostics, `${path}/segments/${segmentIndex}/rel`, options, dialect);
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
  options: InternalValidationOptions
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
    scope.set(node.variable, { kind: "node", labels, valueType: "NODE" });
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
  options: InternalValidationOptions,
  dialect: DialectProfile
) {
  validateDialectRelationship(rel, path, dialect, diagnostics);
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
    scope.set(rel.variable, { kind: "relationship", relationshipTypes: types, valueType: "RELATIONSHIP" });
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

function validateDialectClause(clause: Clause, path: string, dialect: DialectProfile, diagnostics: Diagnostic[]) {
  if (clause.kind === "let" && !dialect.features.letClause) {
    dialectUnsupported(diagnostics, path, dialect, "LET clauses");
  }
  if (clause.kind === "call" && clause.subquery && !dialect.features.subqueries) {
    dialectUnsupported(diagnostics, path, dialect, "CALL subqueries");
  }
  if (isWriteClause(clause) && !dialect.features.writeClauses) {
    dialectUnsupported(diagnostics, path, dialect, "write clauses");
  }
}

function validateDialectPath(pattern: PathPattern, path: string, dialect: DialectProfile, diagnostics: Diagnostic[]) {
  if (pattern.mode && !dialect.features.pathModes) {
    dialectUnsupported(diagnostics, `${path}/mode`, dialect, "path match modes");
  }
  if (pattern.shortest && !dialect.features.shortestPathModes) {
    dialectUnsupported(diagnostics, `${path}/shortest`, dialect, "shortest path modes");
  }
}

function validateDialectRelationship(
  rel: RelationshipPattern,
  path: string,
  dialect: DialectProfile,
  diagnostics: Diagnostic[]
) {
  const hasRange = rel.minHops !== undefined || rel.maxHops !== undefined;
  if (hasRange && !dialect.features.legacyVariableLengthRelationships) {
    diagnostics.push(
      diagnostic({
        code: "dialect-rendering-limitation",
        severity: "warning",
        message: `${dialect.displayName} prefers '${dialect.rendering.relationshipRangeStyle}' relationship ranges, but the current renderer emits legacy star ranges.`,
        path,
        suggestion: "Use the Neo4j/openCypher profiles for legacy star ranges, or keep this as an explicit compatibility exception."
      })
    );
  }
}

function dialectUnsupported(diagnostics: Diagnostic[], path: string, dialect: DialectProfile, feature: string) {
  diagnostics.push(
    diagnostic({
      code: "dialect-unsupported-feature",
      severity: "error",
      message: `${feature} are not supported by the ${dialect.displayName} profile.`,
      path,
      suggestion: "Switch dialect profiles or rewrite the query using supported Cypher features."
    })
  );
}

function validateProperties(
  ownerKind: "node" | "relationship",
  ownerName: string | undefined,
  properties: Record<string, Expression> | undefined,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: InternalValidationOptions
) {
  for (const [propertyName, expression] of Object.entries(properties ?? {})) {
    const property = ownerName ? resolveProperty(schema, ownerKind, ownerName, propertyName) : undefined;
    if (ownerName && !property) {
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
    validateExpectedType(
      expression,
      declaredType(property),
      scope,
      schema,
      diagnostics,
      `${path}/${propertyName}`,
      "property-type-mismatch",
      `Property '${propertyName}' expects ${declaredType(property) ?? "a known type"}.`
    );
  }
}

function validateExpression(
  expression: Expression,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  options: InternalValidationOptions
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
      validateBinaryTypes(expression, scope, schema, diagnostics, path);
      return;
    case "unary":
      validateExpression(expression.expression, scope, schema, diagnostics, `${path}/expression`, options);
      return;
    case "function":
      expression.arguments.forEach((argument, index) =>
        validateExpression(argument, scope, schema, diagnostics, `${path}/arguments/${index}`, options)
      );
      validateFunctionCall(expression, scope, schema, diagnostics, path);
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
  options: InternalValidationOptions
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
    const property = owner ? resolveProperty(schema, "node", owner, expression.key) : undefined;
    if (owner && !property) {
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
    const property = owner ? resolveProperty(schema, "relationship", owner, expression.key) : undefined;
    if (owner && !property) {
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

function validateBinaryTypes(
  expression: Extract<Expression, { kind: "binary" }>,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string
) {
  const leftType = inferExpressionType(expression.left, scope, schema);
  const rightType = inferExpressionType(expression.right, scope, schema);
  const comparableOps = new Set(["=", "<>", "<", "<=", ">", ">="]);
  if (comparableOps.has(expression.op) && leftType && rightType && !typesCompatible(leftType, rightType) && !typesCompatible(rightType, leftType)) {
    diagnostics.push(
      diagnostic({
        code: "comparison-type-mismatch",
        severity: "error",
        message: `Cannot compare ${leftType} to ${rightType} with '${expression.op}'.`,
        path,
        suggestion: "Compare values with compatible Cypher types or cast explicitly before comparing."
      })
    );
  }

  if (expression.op === "IN" && leftType && rightType) {
    const elementType = listElementType(rightType);
    if (!elementType) {
      diagnostics.push(
        diagnostic({
          code: "comparison-type-mismatch",
          severity: "error",
          message: `IN expects a list on the right side, got ${rightType}.`,
          path: `${path}/right`,
          suggestion: "Use a LIST value or collect values before using IN."
        })
      );
    } else if (!typesCompatible(elementType, leftType)) {
      diagnostics.push(
        diagnostic({
          code: "comparison-type-mismatch",
          severity: "error",
          message: `IN compares ${leftType} against LIST<${elementType}>.`,
          path,
          suggestion: "Compare values with compatible Cypher types or cast explicitly before comparing."
        })
      );
    }
  }

  if (expression.op === "CONTAINS" || expression.op === "STARTS WITH" || expression.op === "ENDS WITH") {
    validateExpectedType(expression.left, "STRING", scope, schema, diagnostics, `${path}/left`, "comparison-type-mismatch", `${expression.op} expects a string left operand.`);
    validateExpectedType(expression.right, "STRING", scope, schema, diagnostics, `${path}/right`, "comparison-type-mismatch", `${expression.op} expects a string right operand.`);
  }

  if (expression.op === "AND" || expression.op === "OR" || expression.op === "XOR") {
    validateExpectedType(expression.left, "BOOLEAN", scope, schema, diagnostics, `${path}/left`, "comparison-type-mismatch", `${expression.op} expects boolean operands.`);
    validateExpectedType(expression.right, "BOOLEAN", scope, schema, diagnostics, `${path}/right`, "comparison-type-mismatch", `${expression.op} expects boolean operands.`);
  }

  if (["-", "*", "/", "%", "^"].includes(expression.op)) {
    validateExpectedType(expression.left, "FLOAT", scope, schema, diagnostics, `${path}/left`, "comparison-type-mismatch", `${expression.op} expects numeric operands.`);
    validateExpectedType(expression.right, "FLOAT", scope, schema, diagnostics, `${path}/right`, "comparison-type-mismatch", `${expression.op} expects numeric operands.`);
  }
}

function validateFunctionCall(
  expression: Extract<Expression, { kind: "function" }>,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string
) {
  const schemaFunction = resolveFunction(schema, expression.name);
  if (schemaFunction?.arguments) {
    validateCallableArguments("function", expression.name, schemaFunction.arguments, expression.arguments, scope, schema, diagnostics, `${path}/arguments`);
  }

  const signature = BUILTIN_FUNCTIONS.get(normalizeFunctionName(expression.name));
  if (!signature) {
    return;
  }

  if (expression.arguments.length < signature.minArgs || expression.arguments.length > signature.maxArgs) {
    diagnostics.push(
      diagnostic({
        code: "function-argument-mismatch",
        severity: "error",
        message: `Function '${expression.name}' expects ${arityText(signature.minArgs, signature.maxArgs)}, got ${expression.arguments.length}.`,
        path,
        suggestion: "Adjust the function arguments or choose a function with the desired signature."
      })
    );
  }

  expression.arguments.forEach((argument, index) => {
    const expected = signature.arguments[Math.min(index, signature.arguments.length - 1)];
    if (!expected) {
      return;
    }
    validateOneOfTypes(argument, expected.types, scope, schema, diagnostics, `${path}/arguments/${index}`, "function-argument-mismatch", `Function '${expression.name}' argument '${expected.name}' expects ${expected.types.join(" or ")}.`);
  });
}

function validateCallableArguments(
  kind: "function" | "procedure",
  name: string,
  expectedArguments: Record<string, string | SchemaParameter>,
  actualArguments: Expression[],
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string
) {
  const expected = Object.entries(expectedArguments).map(([argumentName, argument]) => ({
    name: argumentName,
    type: declaredType(argument),
    required: typeof argument === "string" ? true : argument.required !== false
  }));
  const requiredCount = expected.filter((argument) => argument.required).length;
  if (actualArguments.length < requiredCount || actualArguments.length > expected.length) {
    diagnostics.push(
      diagnostic({
        code: `${kind}-argument-mismatch`,
        severity: "error",
        message: `${capitalize(kind)} '${name}' expects ${arityText(requiredCount, expected.length)}, got ${actualArguments.length}.`,
        path,
        suggestion: `Pass arguments that match the ${kind} metadata in the schema contract.`
      })
    );
  }

  actualArguments.forEach((argument, index) => {
    const expectedArgument = expected[index];
    if (!expectedArgument?.type) {
      return;
    }
    validateExpectedType(
      argument,
      expectedArgument.type,
      scope,
      schema,
      diagnostics,
      `${path}/${index}`,
      `${kind}-argument-mismatch`,
      `${capitalize(kind)} '${name}' argument '${expectedArgument.name}' expects ${expectedArgument.type}.`
    );
  });
}

function validateExpectedType(
  expression: Expression,
  expectedType: string | undefined,
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  code: string,
  message: string
) {
  if (!expectedType) {
    return;
  }
  const actualType = inferExpressionType(expression, scope, schema);
  if (!actualType || typesCompatible(expectedType, actualType)) {
    return;
  }
  diagnostics.push(
    diagnostic({
      code: expression.kind === "param" && code === "property-type-mismatch" ? "parameter-type-mismatch" : code,
      severity: "error",
      message: `${message} Received ${actualType}.`,
      path,
      suggestion: "Use a value with the expected Cypher type, change the schema contract, or cast explicitly."
    })
  );
}

function validateOneOfTypes(
  expression: Expression,
  expectedTypes: string[],
  scope: Scope,
  schema: NormalizedSchema,
  diagnostics: Diagnostic[],
  path: string,
  code: string,
  message: string
) {
  const actualType = inferExpressionType(expression, scope, schema);
  if (!actualType || expectedTypes.some((expectedType) => typesCompatible(expectedType, actualType))) {
    return;
  }
  diagnostics.push(
    diagnostic({
      code,
      severity: "error",
      message: `${message} Received ${actualType}.`,
      path,
      suggestion: "Use a compatible argument type or cast before calling the function."
    })
  );
}

function inferExpressionType(expression: Expression, scope: Scope, schema: NormalizedSchema): string | undefined {
  switch (expression.kind) {
    case "var":
      return scope.get(expression.name)?.valueType;
    case "prop":
      return inferPropertyExpressionType(expression, scope, schema);
    case "param":
      return declaredType(schema.parameters.get(expression.name));
    case "literal":
      return literalType(expression.value);
    case "binary":
      if (["=", "<>", "<", "<=", ">", ">=", "IN", "CONTAINS", "STARTS WITH", "ENDS WITH", "AND", "OR", "XOR"].includes(expression.op)) {
        return "BOOLEAN";
      }
      return "FLOAT";
    case "unary":
      return expression.op === "NOT" ? "BOOLEAN" : inferExpressionType(expression.expression, scope, schema);
    case "function":
      return declaredType(resolveFunction(schema, expression.name)?.returns) ?? BUILTIN_FUNCTIONS.get(normalizeFunctionName(expression.name))?.returns;
    case "list": {
      const itemTypes = expression.items.map((item) => inferExpressionType(item, scope, schema)).filter(isString);
      const first = itemTypes[0] ?? "ANY";
      return itemTypes.every((item) => typesCompatible(first, item)) ? `LIST<${first}>` : "LIST<ANY>";
    }
    case "map":
      return "MAP<ANY>";
    case "case": {
      const resultTypes = [
        ...expression.cases.map((branch) => inferExpressionType(branch.then, scope, schema)),
        ...(expression.else ? [inferExpressionType(expression.else, scope, schema)] : [])
      ].filter(isString);
      const first = resultTypes[0];
      return first && resultTypes.every((item) => typesCompatible(first, item)) ? first : "ANY";
    }
    case "raw":
      return undefined;
  }
}

function inferPropertyExpressionType(
  expression: Extract<Expression, { kind: "prop" }>,
  scope: Scope,
  schema: NormalizedSchema
): string | undefined {
  if (expression.object.kind !== "var") {
    return undefined;
  }
  const binding = scope.get(expression.object.name);
  if (binding?.kind === "node") {
    return declaredType(resolveProperty(schema, "node", binding.labels?.[0], expression.key));
  }
  if (binding?.kind === "relationship") {
    return declaredType(resolveProperty(schema, "relationship", binding.relationshipTypes?.[0], expression.key));
  }
  return undefined;
}

function declaredType(value: string | SchemaParameter | SchemaProperty | SchemaFunction["returns"] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return typeof value === "string" ? value : value.type;
}

function literalType(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return Number.isInteger(value) ? "INTEGER" : "FLOAT";
  if (typeof value === "string") return "STRING";
  if (Array.isArray(value)) return "LIST<ANY>";
  return "MAP<ANY>";
}

function typesCompatible(expected: string, actual: string): boolean {
  const normalizedExpected = normalizeType(expected);
  const normalizedActual = normalizeType(actual);
  if (normalizedExpected === "ANY" || normalizedActual === "ANY" || normalizedActual === "NULL") {
    return true;
  }
  if (normalizedExpected === normalizedActual) {
    return true;
  }
  if (normalizedExpected === "FLOAT" && normalizedActual === "INTEGER") {
    return true;
  }
  if (normalizedExpected === "NUMBER" && (normalizedActual === "INTEGER" || normalizedActual === "FLOAT")) {
    return true;
  }
  const expectedList = listElementType(normalizedExpected);
  const actualList = listElementType(normalizedActual);
  if (expectedList && actualList) {
    return typesCompatible(expectedList, actualList);
  }
  return false;
}

function normalizeType(type: string): string {
  return type.trim().toUpperCase();
}

function listElementType(type: string | undefined): string | undefined {
  const match = /^LIST<(.+)>$/i.exec(type ?? "");
  return match?.[1]?.trim();
}

function arityText(minArgs: number, maxArgs: number): string {
  return minArgs === maxArgs ? `${minArgs} argument(s)` : `${minArgs}-${maxArgs} argument(s)`;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function variableName(expression: Expression): string | undefined {
  return expression.kind === "var" ? expression.name : undefined;
}

function inferExpressionBinding(expression: Expression, scope: Scope, schema: NormalizedSchema): VariableBinding {
  if (expression.kind === "var") {
    return scope.get(expression.name) ?? { kind: "unknown" };
  }
  return { kind: "unknown", valueType: inferExpressionType(expression, scope, schema) };
}

interface FunctionArgumentSignature {
  name: string;
  types: string[];
}

interface FunctionSignature {
  minArgs: number;
  maxArgs: number;
  arguments: FunctionArgumentSignature[];
  returns: string;
}

const BUILTIN_FUNCTIONS = new Map<string, FunctionSignature>(
  [
    ["count", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["ANY"] }], returns: "INTEGER" }],
    ["avg", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["INTEGER", "FLOAT"] }], returns: "FLOAT" }],
    ["sum", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["INTEGER", "FLOAT"] }], returns: "FLOAT" }],
    ["min", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["ANY"] }], returns: "ANY" }],
    ["max", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["ANY"] }], returns: "ANY" }],
    ["collect", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["ANY"] }], returns: "LIST<ANY>" }],
    ["length", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["STRING", "PATH", "LIST<ANY>"] }], returns: "INTEGER" }],
    ["size", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["STRING", "LIST<ANY>", "MAP<ANY>"] }], returns: "INTEGER" }],
    ["tointeger", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["ANY"] }], returns: "INTEGER" }],
    ["tofloat", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["ANY"] }], returns: "FLOAT" }],
    ["tostring", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["ANY"] }], returns: "STRING" }],
    ["tolower", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["STRING"] }], returns: "STRING" }],
    ["toupper", { minArgs: 1, maxArgs: 1, arguments: [{ name: "value", types: ["STRING"] }], returns: "STRING" }],
    [
      "substring",
      {
        minArgs: 2,
        maxArgs: 3,
        arguments: [
          { name: "value", types: ["STRING"] },
          { name: "start", types: ["INTEGER"] },
          { name: "length", types: ["INTEGER"] }
        ],
        returns: "STRING"
      }
    ],
    ["coalesce", { minArgs: 1, maxArgs: Number.MAX_SAFE_INTEGER, arguments: [{ name: "value", types: ["ANY"] }], returns: "ANY" }],
    ["date", { minArgs: 0, maxArgs: 1, arguments: [{ name: "value", types: ["ANY"] }], returns: "DATE" }],
    ["datetime", { minArgs: 0, maxArgs: 1, arguments: [{ name: "value", types: ["ANY"] }], returns: "ZONED_DATETIME" }]
  ].map(([name, signature]) => [normalizeFunctionName(name as string), signature as FunctionSignature])
);

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

function exportedSubqueryBindings(query: CypherQuery | undefined, scope: Scope, schema: NormalizedSchema): Scope {
  const exported: Scope = new Map();
  const finalClause = query?.clauses.at(-1);
  if (!finalClause || finalClause.kind !== "return") {
    return exported;
  }
  for (const item of finalClause.items) {
    const alias = item.alias ?? variableName(item.expression);
    if (alias) {
      exported.set(alias, inferExpressionBinding(item.expression, scope, schema));
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
  return AGGREGATE_FUNCTIONS.has(normalizeFunctionName(name));
}

function normalizeFunctionName(name: string): string {
  return name.replaceAll(".", "").toLowerCase();
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

function dialectProfileFor(id: string): DialectProfile {
  try {
    return getDialectProfile(id as DialectProfileId);
  } catch {
    return getDialectProfile("neo4j-cypher-25");
  }
}
