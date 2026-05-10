import type { Clause, CypherQuery, CypherSchemaContract, Expression, MatchClause, NodePattern, RelationshipPattern, ReturnClause } from "./ir.js";
import { isWriteClause } from "./validate.js";

export type PolicySeverity = "info" | "warning" | "error";

export interface CypherPolicyOptions {
  allowWrites?: boolean;
  requireLimit?: boolean;
  maxReturnLimit?: number;
  maxRelationshipHops?: number;
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
  summary: CypherPolicySummary;
  findings: CypherPolicyFinding[];
}

const DEFAULT_OPTIONS: Required<CypherPolicyOptions> = {
  allowWrites: false,
  requireLimit: true,
  maxReturnLimit: 100,
  maxRelationshipHops: 5
};

export function assessCypherPolicy(
  query: CypherQuery,
  schema: CypherSchemaContract,
  options: CypherPolicyOptions = {}
): CypherPolicyReport {
  const opts = { ...DEFAULT_OPTIONS, ...options };
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
      assessMatchPolicy(clause, path, findings, opts);
    }
    if (clause.kind === "return") {
      assessReturnPolicy(clause, path, findings, opts);
    }
  });

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
    summary,
    findings
  };
}

function assessMatchPolicy(
  clause: MatchClause,
  path: string,
  findings: CypherPolicyFinding[],
  options: Required<CypherPolicyOptions>
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
    assessHeadNodePolicy(head, clause, `${path}/patterns/${patternIndex}/segments/0`, findings);
    tail.forEach((segment, segmentIndex) => {
      assessRelationshipPolicy(segment.rel, `${path}/patterns/${patternIndex}/segments/${segmentIndex + 1}/rel`, findings, options);
    });
  });
}

function assessHeadNodePolicy(
  node: NodePattern,
  clause: MatchClause,
  path: string,
  findings: CypherPolicyFinding[]
) {
  const hasPredicate = Boolean(clause.where || node.where || Object.keys(node.properties ?? {}).length > 0);
  if (hasPredicate) {
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
}

function assessRelationshipPolicy(
  relationship: RelationshipPattern,
  path: string,
  findings: CypherPolicyFinding[],
  options: Required<CypherPolicyOptions>
) {
  if (relationship.maxHops === null) {
    findings.push({
      code: "policy-unbounded-traversal",
      severity: "error",
      message: "Variable-length traversal has no maximum hop count.",
      path,
      suggestion: `Set maxHops to ${options.maxRelationshipHops} or lower before execution.`
    });
    return;
  }

  if (relationship.maxHops !== undefined && relationship.maxHops > options.maxRelationshipHops) {
    findings.push({
      code: "policy-high-hop-traversal",
      severity: "warning",
      message: `Variable-length traversal allows ${relationship.maxHops} hops, above the policy maximum of ${options.maxRelationshipHops}.`,
      path,
      suggestion: "Lower maxHops or require an explicit policy override."
    });
  }
}

function assessReturnPolicy(
  clause: ReturnClause,
  path: string,
  findings: CypherPolicyFinding[],
  options: Required<CypherPolicyOptions>
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

function numericLiteral(expression: Expression): number | undefined {
  return expression.kind === "literal" && typeof expression.value === "number" ? expression.value : undefined;
}
