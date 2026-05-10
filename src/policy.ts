import type { Clause, CypherQuery, CypherSchemaContract, Expression, MatchClause, NodePattern, RelationshipPattern, ReturnClause } from "./ir.js";
import type { CypherPlannerEstimate, CypherPlannerOperatorEstimate } from "./planner-estimate.js";
import { flattenPlannerOperators } from "./planner-estimate.js";
import type { CypherPolicyRuleSet, CypherPolicyRuleSetSummary, CypherTenantScopeRule } from "./policy-rules.js";
import { summarizePolicyRules } from "./policy-rules.js";
import type { CypherNodeLabelStatistics, CypherSchemaStatistics } from "./schema-statistics.js";
import { findNodeStatistics, findRelationshipStatistics, hasIndexedProperty } from "./schema-statistics.js";
import { canonicalLabel, canonicalRelationshipType, normalizeSchema, type NormalizedSchema } from "./schema.js";
import { isWriteClause } from "./validate.js";

export type PolicySeverity = "info" | "warning" | "error";

export interface CypherPolicyOptions {
  allowWrites?: boolean;
  requireLimit?: boolean;
  maxReturnLimit?: number;
  maxRelationshipHops?: number;
  maxEstimatedRows?: number;
  maxDbHits?: number;
  maxLabelScanRows?: number;
  maxRelationshipFanout?: number;
  warnOnPlanOperators?: string[];
  plannerEstimate?: CypherPlannerEstimate;
  schemaStatistics?: CypherSchemaStatistics;
  policyRules?: CypherPolicyRuleSet;
  profile?: CypherPolicyProfileRef;
}

export interface CypherPolicyProfileRef {
  id: string;
  title?: string;
}

export interface CypherPolicyFinding {
  code: string;
  severity: PolicySeverity;
  message: string;
  path: string;
  suggestion: string;
}

export interface CypherPolicySummary {
  findings: number;
  errors: number;
  warnings: number;
  infos: number;
}

export interface CypherPolicyReport {
  version: "cypher-llm-policy-report/v1";
  ok: boolean;
  dialect?: string;
  policy?: CypherPolicyProfileRef;
  rules?: CypherPolicyRuleSetSummary;
  planner?: CypherPolicyPlannerSummary;
  statistics?: CypherPolicyStatisticsSummary;
  summary: CypherPolicySummary;
  findings: CypherPolicyFinding[];
}

export interface CypherPolicyEvidence {
  version: "cypher-llm-policy-evidence/v1";
  ok: boolean;
  policy?: CypherPolicyProfileRef;
  rules?: CypherPolicyRuleSetSummary;
  planner?: CypherPolicyPlannerSummary;
  statistics?: CypherPolicyStatisticsSummary;
  summary: CypherPolicySummary;
  findingCodes: string[];
}

export interface CypherPolicyPlannerSummary {
  source: string;
  operators: number;
  estimatedRows?: number;
  dbHits?: number;
}

export interface CypherPolicyStatisticsSummary {
  source: string;
  labels: number;
  relationships: number;
}

type EffectivePolicyOptions = Required<
  Omit<CypherPolicyOptions, "profile" | "plannerEstimate" | "schemaStatistics" | "policyRules">
>;

interface PolicyVariableBinding {
  kind: "node" | "relationship";
  names: string[];
}

const DEFAULT_OPTIONS: EffectivePolicyOptions = {
  allowWrites: false,
  requireLimit: true,
  maxReturnLimit: 100,
  maxRelationshipHops: 5,
  maxEstimatedRows: 10_000,
  maxDbHits: 50_000,
  maxLabelScanRows: 10_000,
  maxRelationshipFanout: 100,
  warnOnPlanOperators: ["AllNodesScan", "NodeByLabelScan", "CartesianProduct", "Eager"]
};

export function assessCypherPolicy(
  query: CypherQuery,
  schema: CypherSchemaContract,
  options: CypherPolicyOptions = {}
): CypherPolicyReport {
  const normalizedSchema = normalizeSchema(schema);
  const variableBindings = collectVariableBindings(query, normalizedSchema);
  const opts: EffectivePolicyOptions = {
    allowWrites: options.allowWrites ?? DEFAULT_OPTIONS.allowWrites,
    requireLimit: options.requireLimit ?? DEFAULT_OPTIONS.requireLimit,
    maxReturnLimit: options.maxReturnLimit ?? DEFAULT_OPTIONS.maxReturnLimit,
    maxRelationshipHops: options.maxRelationshipHops ?? DEFAULT_OPTIONS.maxRelationshipHops,
    maxEstimatedRows: options.maxEstimatedRows ?? DEFAULT_OPTIONS.maxEstimatedRows,
    maxDbHits: options.maxDbHits ?? DEFAULT_OPTIONS.maxDbHits,
    maxLabelScanRows: options.maxLabelScanRows ?? DEFAULT_OPTIONS.maxLabelScanRows,
    maxRelationshipFanout: options.maxRelationshipFanout ?? DEFAULT_OPTIONS.maxRelationshipFanout,
    warnOnPlanOperators: options.warnOnPlanOperators ?? DEFAULT_OPTIONS.warnOnPlanOperators
  };
  const findings: CypherPolicyFinding[] = [];

  query.clauses.forEach((clause, clauseIndex) => {
    const path = `/clauses/${clauseIndex}`;
    if (isWriteClause(clause) && !opts.allowWrites) {
      findings.push({
        code: "policy-write-risk",
        severity: "error",
        message: `Clause '${clause.kind}' mutates the graph and is blocked by policy.`,
        path,
        suggestion: "Require an explicit approval path before allowing write clauses."
      });
    }
    if (clause.kind === "match") {
      assessMatchPolicy(clause, path, findings, opts, options.schemaStatistics, options.policyRules, normalizedSchema);
    }
    if (clause.kind === "return") {
      assessReturnPolicy(clause, path, findings, opts, options.policyRules, variableBindings, normalizedSchema);
    }
  });

  if (options.plannerEstimate) {
    assessPlannerPolicy(options.plannerEstimate, findings, opts);
  }

  const summary = {
    findings: findings.length,
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    infos: findings.filter((finding) => finding.severity === "info").length
  };

  return {
    version: "cypher-llm-policy-report/v1",
    ok: summary.errors === 0,
    ...(schema.dialect ? { dialect: schema.dialect } : {}),
    ...(options.profile ? { policy: options.profile } : {}),
    ...(options.policyRules ? { rules: summarizePolicyRules(options.policyRules) } : {}),
    ...(options.plannerEstimate ? { planner: plannerSummary(options.plannerEstimate) } : {}),
    ...(options.schemaStatistics ? { statistics: statisticsSummary(options.schemaStatistics) } : {}),
    summary,
    findings
  };
}

export function summarizePolicyEvidence(report: CypherPolicyReport): CypherPolicyEvidence {
  return {
    version: "cypher-llm-policy-evidence/v1",
    ok: report.ok,
    ...(report.policy ? { policy: report.policy } : {}),
    ...(report.rules ? { rules: report.rules } : {}),
    ...(report.planner ? { planner: report.planner } : {}),
    ...(report.statistics ? { statistics: report.statistics } : {}),
    summary: report.summary,
    findingCodes: [...new Set(report.findings.map((finding) => finding.code))]
  };
}

function assessMatchPolicy(
  clause: MatchClause,
  path: string,
  findings: CypherPolicyFinding[],
  options: EffectivePolicyOptions,
  statistics: CypherSchemaStatistics | undefined,
  policyRules: CypherPolicyRuleSet | undefined,
  schema: NormalizedSchema
) {
  if (clause.patterns.length > 1) {
    findings.push({
      code: "policy-cartesian-pattern-risk",
      severity: "warning",
      message: "MATCH contains multiple patterns, which can create a cartesian product if they are not connected later.",
      path: `${path}/patterns`,
      suggestion: "Prefer a connected pattern or add explicit predicates before returning rows."
    });
  }

  clause.patterns.forEach((pattern, patternIndex) => {
    const [head, ...tail] = pattern.segments;
    const headPath = `${path}/patterns/${patternIndex}/segments/0`;
    assessHeadNodePolicy(head, clause, headPath, findings, options, statistics, schema);
    assessNodeRulePolicy(head, clause, headPath, findings, policyRules, schema);
    tail.forEach((segment, segmentIndex) => {
      const segmentPath = `${path}/patterns/${patternIndex}/segments/${segmentIndex + 1}`;
      assessRelationshipPolicy(
        segment.rel,
        `${segmentPath}/rel`,
        findings,
        options,
        statistics,
        policyRules,
        schema
      );
      assessNodeRulePolicy(segment.node, clause, `${segmentPath}/node`, findings, policyRules, schema);
    });
  });
}

function assessHeadNodePolicy(
  node: NodePattern,
  clause: MatchClause,
  path: string,
  findings: CypherPolicyFinding[],
  options: EffectivePolicyOptions,
  statistics: CypherSchemaStatistics | undefined,
  schema: NormalizedSchema
) {
  const hasPredicate = Boolean(clause.where || node.where || Object.keys(node.properties ?? {}).length > 0);
  const label = node.labels?.length === 1 ? canonicalLabel(schema, node.labels[0] as string) ?? node.labels[0] : undefined;
  const nodeStatistics = statistics && label ? findNodeStatistics(statistics, label) : undefined;
  if (hasPredicate) {
    if (
      label !== undefined &&
      nodeStatistics &&
      nodeStatistics.count !== undefined &&
      nodeStatistics.count > options.maxLabelScanRows
    ) {
      assessPredicateIndexPolicy(node, label, nodeStatistics, path, findings);
    }
    return;
  }

  findings.push({
    code: node.labels?.length ? "policy-unfiltered-label-scan" : "policy-unfiltered-node-scan",
    severity: "warning",
    message: node.labels?.length
      ? `MATCH starts from label '${node.labels.join(":")}' without a predicate.`
      : "MATCH starts from an unlabeled node without a predicate.",
    path,
    suggestion: "Anchor the traversal with a parameterized property, WHERE predicate, or known path template."
  });

  if (nodeStatistics?.count !== undefined && nodeStatistics.count > options.maxLabelScanRows) {
    findings.push({
      code: "policy-high-cardinality-label-scan",
      severity: "warning",
      message: `Label '${label}' has ${nodeStatistics.count} estimated nodes, above the policy maximum of ${options.maxLabelScanRows}.`,
      path,
      suggestion: "Add an indexed predicate or require an explicit policy override before scanning this label."
    });
  }
}

function assessRelationshipPolicy(
  relationship: RelationshipPattern,
  path: string,
  findings: CypherPolicyFinding[],
  options: EffectivePolicyOptions,
  statistics: CypherSchemaStatistics | undefined,
  policyRules: CypherPolicyRuleSet | undefined,
  schema: NormalizedSchema
) {
  if (relationship.maxHops === null) {
    findings.push({
      code: "policy-unbounded-traversal",
      severity: "error",
      message: "Variable-length traversal has no maximum hop count.",
      path,
      suggestion: `Set maxHops to ${options.maxRelationshipHops} or lower before execution.`
    });
  }

  if (relationship.maxHops !== null && relationship.maxHops !== undefined && relationship.maxHops > options.maxRelationshipHops) {
    findings.push({
      code: "policy-high-hop-traversal",
      severity: "warning",
      message: `Variable-length traversal allows ${relationship.maxHops} hops, above the policy maximum of ${options.maxRelationshipHops}.`,
      path,
      suggestion: "Lower maxHops or require an explicit policy override."
    });
  }

  const relationshipType =
    relationship.types?.length === 1
      ? canonicalRelationshipType(schema, relationship.types[0] as string) ?? relationship.types[0]
      : undefined;
  if (relationshipType && policyRules) {
    assessRelationshipRulePolicy(relationshipType, path, findings, policyRules, schema);
  }
  const relationshipStatistics = relationshipType && statistics ? findRelationshipStatistics(statistics, relationshipType) : undefined;
  if (relationshipStatistics?.averageFanout !== undefined && relationshipStatistics.averageFanout > options.maxRelationshipFanout) {
    findings.push({
      code: "policy-high-fanout-relationship",
      severity: "warning",
      message: `Relationship '${relationshipType}' has average fanout ${relationshipStatistics.averageFanout}, above the policy maximum of ${options.maxRelationshipFanout}.`,
      path,
      suggestion: "Anchor the traversal more tightly, lower maxHops, or require a policy override for this relationship."
    });
  }
}

function assessReturnPolicy(
  clause: ReturnClause,
  path: string,
  findings: CypherPolicyFinding[],
  options: EffectivePolicyOptions,
  policyRules: CypherPolicyRuleSet | undefined,
  variableBindings: Map<string, PolicyVariableBinding>,
  schema: NormalizedSchema
) {
  assessReturnRulePolicy(clause, path, findings, policyRules, variableBindings, schema);

  if (!clause.limit && options.requireLimit) {
    findings.push({
      code: "policy-missing-limit",
      severity: "warning",
      message: "RETURN has no LIMIT.",
      path,
      suggestion: "Add a bounded LIMIT before allowing autonomous execution."
    });
  }

  const limit = clause.limit ? numericLiteral(clause.limit) : undefined;
  if (limit !== undefined && limit > options.maxReturnLimit) {
    findings.push({
      code: "policy-high-return-limit",
      severity: "warning",
      message: `RETURN LIMIT ${limit} is above the policy maximum of ${options.maxReturnLimit}.`,
      path: `${path}/limit`,
      suggestion: "Lower the LIMIT or require an explicit policy override."
    });
  }
}

function assessPlannerPolicy(
  estimate: CypherPlannerEstimate,
  findings: CypherPolicyFinding[],
  options: EffectivePolicyOptions
) {
  if (estimate.estimatedRows !== undefined && estimate.estimatedRows > options.maxEstimatedRows) {
    findings.push({
      code: "policy-high-estimated-rows",
      severity: "warning",
      message: `Planner estimates up to ${estimate.estimatedRows} rows, above the policy maximum of ${options.maxEstimatedRows}.`,
      path: "/plannerEstimate/estimatedRows",
      suggestion: "Add predicates, indexes, lower traversal fanout, or require an explicit policy override."
    });
  }

  if (estimate.dbHits !== undefined && estimate.dbHits > options.maxDbHits) {
    findings.push({
      code: "policy-high-db-hits",
      severity: "warning",
      message: `Planner estimates ${estimate.dbHits} db hits, above the policy maximum of ${options.maxDbHits}.`,
      path: "/plannerEstimate/dbHits",
      suggestion: "Review the plan, add an index-backed predicate, or require an explicit policy override."
    });
  }

  const warnOperators = new Set(options.warnOnPlanOperators);
  walkPlannerOperators(estimate.operators, "/plannerEstimate/operators", (operator, path) => {
    if (!warnOperators.has(operator.name)) {
      return;
    }
    findings.push({
      code: "policy-expensive-plan-operator",
      severity: "warning",
      message: `Planner uses ${operator.name}.`,
      path,
      suggestion: "Prefer indexed lookups, connected patterns, and lower-cardinality anchors before autonomous execution."
    });
  });

  estimate.warnings?.forEach((warning, index) => {
    findings.push({
      code: "policy-planner-estimate-warning",
      severity: "info",
      message: warning,
      path: `/plannerEstimate/warnings/${index}`,
      suggestion: "Treat incomplete planner evidence as a reason to keep the query in review or EXPLAIN-only mode."
    });
  });
}

function assessPredicateIndexPolicy(
  node: NodePattern,
  label: string,
  nodeStatistics: CypherNodeLabelStatistics,
  path: string,
  findings: CypherPolicyFinding[]
) {
  for (const property of Object.keys(node.properties ?? {})) {
    if (hasIndexedProperty(nodeStatistics, property)) {
      continue;
    }
    findings.push({
      code: "policy-unindexed-high-cardinality-predicate",
      severity: "warning",
      message: `Predicate on '${property}' is not listed as indexed for high-cardinality label '${label}'.`,
      path: `${path}/properties/${property}`,
      suggestion: "Use an indexed property, add index metadata to schema statistics, or require an explicit policy override."
    });
  }
}

function assessNodeRulePolicy(
  node: NodePattern,
  clause: MatchClause,
  path: string,
  findings: CypherPolicyFinding[],
  policyRules: CypherPolicyRuleSet | undefined,
  schema: NormalizedSchema
) {
  if (!policyRules) {
    return;
  }

  const labels = (node.labels ?? []).map((label) => canonicalLabel(schema, label) ?? label);
  for (const label of labels) {
    for (const rule of policyRules.sensitiveLabels ?? []) {
      const ruleLabel = canonicalLabel(schema, rule.label) ?? rule.label;
      if (ruleLabel !== label) {
        continue;
      }
      findings.push({
        code: "policy-sensitive-label-access",
        severity: ruleSeverity(rule.severity, "warning"),
        message: `MATCH touches sensitive label '${label}'.`,
        path,
        suggestion: rule.reason ?? "Require a narrower predicate, approval, or redacted projection before execution."
      });
    }

    for (const rule of policyRules.tenantScopes ?? []) {
      const ruleLabel = canonicalLabel(schema, rule.label) ?? rule.label;
      if (ruleLabel !== label || nodeSatisfiesTenantScope(node, clause, rule)) {
        continue;
      }
      const parameter = rule.parameter ? ` parameter '$${rule.parameter}'` : " a tenant/scoping value";
      findings.push({
        code: "policy-missing-tenant-scope",
        severity: ruleSeverity(rule.severity, "error"),
        message: `Label '${label}' must be constrained by '${rule.property}' using${parameter}.`,
        path,
        suggestion: rule.reason ?? "Add the required tenant/scoping predicate or require an explicit policy override."
      });
    }
  }
}

function assessRelationshipRulePolicy(
  relationshipType: string,
  path: string,
  findings: CypherPolicyFinding[],
  policyRules: CypherPolicyRuleSet,
  schema: NormalizedSchema
) {
  for (const rule of policyRules.sensitiveRelationships ?? []) {
    const ruleType = canonicalRelationshipType(schema, rule.type) ?? rule.type;
    if (ruleType !== relationshipType) {
      continue;
    }
    findings.push({
      code: "policy-sensitive-relationship-access",
      severity: ruleSeverity(rule.severity, "warning"),
      message: `MATCH traverses sensitive relationship '${relationshipType}'.`,
      path,
      suggestion: rule.reason ?? "Require a narrower predicate, approval, or redacted projection before execution."
    });
  }
}

function assessReturnRulePolicy(
  clause: ReturnClause,
  path: string,
  findings: CypherPolicyFinding[],
  policyRules: CypherPolicyRuleSet | undefined,
  variableBindings: Map<string, PolicyVariableBinding>,
  schema: NormalizedSchema
) {
  if (!policyRules) {
    return;
  }

  clause.items.forEach((item, itemIndex) => {
    for (const reference of collectPropertyReferences(item.expression)) {
      const binding = reference.variable ? variableBindings.get(reference.variable) : undefined;
      for (const rule of policyRules.sensitiveProperties ?? []) {
        if (!sensitivePropertyRuleMatches(rule, reference.property, binding, schema)) {
          continue;
        }
        const propertyName = reference.variable ? `${reference.variable}.${reference.property}` : reference.property;
        findings.push({
          code: "policy-sensitive-property-return",
          severity: ruleSeverity(rule.severity, "error"),
          message: `RETURN projects sensitive property '${propertyName}'.`,
          path: `${path}/items/${itemIndex}/expression`,
          suggestion: rule.reason ?? "Return a redacted value, aggregate, or explicit approval-backed projection."
        });
      }
    }
  });
}

function nodeSatisfiesTenantScope(node: NodePattern, clause: MatchClause, rule: CypherTenantScopeRule): boolean {
  const patternValue = node.properties?.[rule.property];
  if (patternValue && valueSatisfiesTenantScope(patternValue, rule)) {
    return true;
  }
  if (!node.variable) {
    return false;
  }
  return (
    expressionContainsTenantScope(node.where, node.variable, rule) ||
    expressionContainsTenantScope(clause.where, node.variable, rule)
  );
}

function expressionContainsTenantScope(
  expression: Expression | undefined,
  variable: string,
  rule: CypherTenantScopeRule
): boolean {
  if (!expression) {
    return false;
  }
  if (expression.kind !== "binary") {
    return false;
  }
  if (expression.op === "AND") {
    return (
      expressionContainsTenantScope(expression.left, variable, rule) ||
      expressionContainsTenantScope(expression.right, variable, rule)
    );
  }
  if (expression.op !== "=" && expression.op !== "IN") {
    return false;
  }
  return (
    (propertyMatchesTenantScope(expression.left, variable, rule.property) &&
      valueSatisfiesTenantScope(expression.right, rule)) ||
    (propertyMatchesTenantScope(expression.right, variable, rule.property) &&
      valueSatisfiesTenantScope(expression.left, rule))
  );
}

function propertyMatchesTenantScope(expression: Expression, variable: string, property: string): boolean {
  return (
    expression.kind === "prop" &&
    expression.key === property &&
    expression.object.kind === "var" &&
    expression.object.name === variable
  );
}

function valueSatisfiesTenantScope(expression: Expression, rule: CypherTenantScopeRule): boolean {
  return rule.parameter ? expression.kind === "param" && expression.name === rule.parameter : true;
}

function sensitivePropertyRuleMatches(
  rule: NonNullable<CypherPolicyRuleSet["sensitiveProperties"]>[number],
  property: string,
  binding: PolicyVariableBinding | undefined,
  schema: NormalizedSchema
): boolean {
  if (rule.property !== property) {
    return false;
  }
  const ownerKind = rule.ownerKind ?? "any";
  if (ownerKind !== "any" && binding?.kind !== ownerKind) {
    return false;
  }
  if (!rule.owner) {
    return true;
  }
  if (!binding) {
    return false;
  }
  const owner =
    binding.kind === "relationship"
      ? canonicalRelationshipType(schema, rule.owner) ?? rule.owner
      : canonicalLabel(schema, rule.owner) ?? rule.owner;
  return binding.names.includes(owner);
}

function collectPropertyReferences(expression: Expression): { variable?: string; property: string }[] {
  const references: { variable?: string; property: string }[] = [];
  walkExpression(expression, (item) => {
    if (item.kind !== "prop") {
      return;
    }
    references.push({
      ...(item.object.kind === "var" ? { variable: item.object.name } : {}),
      property: item.key
    });
  });
  return references;
}

function collectVariableBindings(query: CypherQuery, schema: NormalizedSchema): Map<string, PolicyVariableBinding> {
  const bindings = new Map<string, PolicyVariableBinding>();
  for (const clause of query.clauses) {
    if (clause.kind === "match") {
      for (const pattern of clause.patterns) {
        const [head, ...tail] = pattern.segments;
        registerNodeBinding(bindings, head, schema);
        for (const segment of tail) {
          registerRelationshipBinding(bindings, segment.rel, schema);
          registerNodeBinding(bindings, segment.node, schema);
        }
      }
    }
    if (clause.kind === "call" && clause.subquery) {
      for (const [name, binding] of collectVariableBindings(clause.subquery, schema)) {
        registerBinding(bindings, name, binding);
      }
    }
  }
  return bindings;
}

function registerNodeBinding(
  bindings: Map<string, PolicyVariableBinding>,
  node: NodePattern,
  schema: NormalizedSchema
) {
  if (!node.variable) {
    return;
  }
  const labels = (node.labels ?? []).map((label) => canonicalLabel(schema, label) ?? label);
  registerBinding(bindings, node.variable, { kind: "node", names: labels });
}

function registerRelationshipBinding(
  bindings: Map<string, PolicyVariableBinding>,
  relationship: RelationshipPattern,
  schema: NormalizedSchema
) {
  if (!relationship.variable) {
    return;
  }
  const types = (relationship.types ?? []).map((type) => canonicalRelationshipType(schema, type) ?? type);
  registerBinding(bindings, relationship.variable, { kind: "relationship", names: types });
}

function registerBinding(
  bindings: Map<string, PolicyVariableBinding>,
  name: string,
  binding: PolicyVariableBinding
) {
  const existing = bindings.get(name);
  if (!existing || existing.kind !== binding.kind) {
    bindings.set(name, binding);
    return;
  }
  bindings.set(name, { kind: existing.kind, names: [...new Set([...existing.names, ...binding.names])] });
}

function walkExpression(expression: Expression, visit: (expression: Expression) => void) {
  visit(expression);
  switch (expression.kind) {
    case "prop":
      walkExpression(expression.object, visit);
      return;
    case "binary":
      walkExpression(expression.left, visit);
      walkExpression(expression.right, visit);
      return;
    case "unary":
      walkExpression(expression.expression, visit);
      return;
    case "function":
      expression.arguments.forEach((argument) => walkExpression(argument, visit));
      return;
    case "list":
      expression.items.forEach((item) => walkExpression(item, visit));
      return;
    case "map":
      Object.values(expression.entries).forEach((value) => walkExpression(value, visit));
      return;
    case "case":
      if (expression.expression) {
        walkExpression(expression.expression, visit);
      }
      expression.cases.forEach((caseItem) => {
        walkExpression(caseItem.when, visit);
        walkExpression(caseItem.then, visit);
      });
      if (expression.else) {
        walkExpression(expression.else, visit);
      }
      return;
    case "var":
    case "param":
    case "literal":
    case "raw":
      return;
  }
}

function ruleSeverity(severity: PolicySeverity | undefined, fallback: PolicySeverity): PolicySeverity {
  return severity ?? fallback;
}

function walkPlannerOperators(
  operators: readonly CypherPlannerOperatorEstimate[],
  basePath: string,
  visit: (operator: CypherPlannerOperatorEstimate, path: string) => void
) {
  operators.forEach((operator, index) => {
    const path = `${basePath}/${index}`;
    visit(operator, path);
    walkPlannerOperators(operator.children ?? [], `${path}/children`, visit);
  });
}

function plannerSummary(estimate: CypherPlannerEstimate): CypherPolicyPlannerSummary {
  return {
    source: estimate.source,
    operators: flattenPlannerOperators(estimate.operators).length,
    ...(estimate.estimatedRows !== undefined ? { estimatedRows: estimate.estimatedRows } : {}),
    ...(estimate.dbHits !== undefined ? { dbHits: estimate.dbHits } : {})
  };
}

function statisticsSummary(statistics: CypherSchemaStatistics): CypherPolicyStatisticsSummary {
  return {
    source: statistics.source,
    labels: statistics.nodes.length,
    relationships: statistics.relationships.length
  };
}

function numericLiteral(expression: Expression): number | undefined {
  return expression.kind === "literal" && typeof expression.value === "number" ? expression.value : undefined;
}
