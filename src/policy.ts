import type { Clause, CypherQuery, CypherSchemaContract, Expression, MatchClause, NodePattern, RelationshipPattern, ReturnClause } from "./ir.js";
import type { CypherPlannerEstimate, CypherPlannerOperatorEstimate } from "./planner-estimate.js";
import { flattenPlannerOperators } from "./planner-estimate.js";
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
  planner?: CypherPolicyPlannerSummary;
  statistics?: CypherPolicyStatisticsSummary;
  summary: CypherPolicySummary;
  findings: CypherPolicyFinding[];
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

type EffectivePolicyOptions = Required<Omit<CypherPolicyOptions, "profile" | "plannerEstimate" | "schemaStatistics">>;

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
      assessMatchPolicy(clause, path, findings, opts, options.schemaStatistics, normalizedSchema);
    }
    if (clause.kind === "return") {
      assessReturnPolicy(clause, path, findings, opts);
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
    ...(options.plannerEstimate ? { planner: plannerSummary(options.plannerEstimate) } : {}),
    ...(options.schemaStatistics ? { statistics: statisticsSummary(options.schemaStatistics) } : {}),
    summary,
    findings
  };
}

function assessMatchPolicy(
  clause: MatchClause,
  path: string,
  findings: CypherPolicyFinding[],
  options: EffectivePolicyOptions,
  statistics: CypherSchemaStatistics | undefined,
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
    assessHeadNodePolicy(head, clause, `${path}/patterns/${patternIndex}/segments/0`, findings, options, statistics, schema);
    tail.forEach((segment, segmentIndex) => {
      assessRelationshipPolicy(
        segment.rel,
        `${path}/patterns/${patternIndex}/segments/${segmentIndex + 1}/rel`,
        findings,
        options,
        statistics,
        schema
      );
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
  options: EffectivePolicyOptions
) {
  if (!clause.limit && options.requireLimit) {
    findings.push({
      code: "policy-missing-limit",
      severity: "warning",
      message: "RETURN has no LIMIT.",
      path,
      suggestion: "Add a bounded LIMIT before allowing autonomous execution."
    });
    return;
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
