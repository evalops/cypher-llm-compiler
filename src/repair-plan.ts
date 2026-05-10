import { diagnostic, type Diagnostic } from "./diagnostics.js";
import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import type { CypherPolicyOptions } from "./policy.js";
import { assessCypherPolicy } from "./policy.js";
import { repairQuery, type RepairAction, type RepairOptions } from "./repair.js";
import { renderQuery } from "./render.js";
import { createSafeExecutionPlan } from "./safety.js";
import { normalizeSchema } from "./schema.js";
import { validateQuery } from "./validate.js";

export type RepairPlanStatus = "ready" | "needs-model" | "blocked";
export type RepairPlanStepClass = "deterministic" | "model-required" | "unsafe";

export interface RepairPlanOptions extends RepairOptions {
  params?: Record<string, JsonLiteral>;
  parserMode?: "syntax" | "lint";
  allowWrites?: boolean;
  approved?: boolean;
  requireLimit?: boolean;
  maxReturnLimit?: number;
  maxRelationshipHops?: number;
  maxEstimatedRows?: number;
  maxDbHits?: number;
  maxLabelScanRows?: number;
  maxRelationshipFanout?: number;
  warnOnPlanOperators?: string[];
  plannerEstimate?: CypherPolicyOptions["plannerEstimate"];
  schemaStatistics?: CypherPolicyOptions["schemaStatistics"];
  policyRules?: CypherPolicyOptions["policyRules"];
}

export interface RepairPlanPatch {
  op: "add" | "replace";
  path: string;
  value: unknown;
}

export interface RepairPlanStep {
  id: string;
  class: RepairPlanStepClass;
  rank: number;
  title: string;
  path?: string;
  diagnostics: Diagnostic[];
  patch?: RepairPlanPatch;
  before?: unknown;
  after?: unknown;
  rationale: string;
}

export interface CypherRepairPlan {
  version: "cypher-llm-repair-plan/v1";
  status: RepairPlanStatus;
  cypherBefore: string;
  cypherAfter: string;
  deterministic: RepairPlanStep[];
  modelRequired: RepairPlanStep[];
  unsafe: RepairPlanStep[];
  diagnostics: Diagnostic[];
  summary: {
    deterministic: number;
    modelRequired: number;
    unsafe: number;
    diagnostics: number;
  };
}

const MODEL_REQUIRED_CODES = new Set([
  "undefined-variable",
  "unknown-label",
  "unknown-relationship-type",
  "unknown-property",
  "missing-required-parameter",
  "aggregate-in-match-where",
  "aggregate-alias-required",
  "ambiguous-aggregate-expression",
  "procedure-unknown-yield",
  "function-argument-type-mismatch",
  "property-type-mismatch",
  "parameter-type-mismatch"
]);

const UNSAFE_CODES = new Set([
  "write-requires-approval",
  "execution-approval-required",
  "policy-write-risk",
  "policy-unbounded-traversal",
  "policy-cartesian-pattern-risk",
  "policy-sensitive-label-access",
  "policy-sensitive-relationship-access",
  "policy-sensitive-property-return",
  "policy-missing-tenant-scope"
]);

export function buildCypherRepairPlan(
  query: CypherQuery,
  schema: CypherSchemaContract,
  options: RepairPlanOptions = {}
): CypherRepairPlan {
  const normalized = normalizeSchema(schema);
  const params = options.params ?? {};
  const beforeDiagnostics = validateQuery(query, normalized).diagnostics;
  const repaired = repairQuery(query, normalized, options);
  const plan = createSafeExecutionPlan(repaired.query, normalized, params, options);
  const parser = validateCypherTextWithParser(plan.cypher, normalized, { mode: options.parserMode ?? "syntax" });
  const policy = assessCypherPolicy(repaired.query, schema, policyOptionsFromRepairPlanOptions(options));
  const policyDiagnostics = policy.findings.map((finding) =>
    diagnostic({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      path: finding.path,
      suggestion: finding.suggestion
    })
  );
  const diagnostics = uniqueDiagnostics([
    ...beforeDiagnostics,
    ...repaired.diagnostics,
    ...plan.diagnostics,
    ...parser.diagnostics,
    ...policyDiagnostics
  ]);
  const deterministic = repaired.applied.map((repair, index) => deterministicStep(repair, index));
  const unsafe = diagnostics.filter((item) => item.severity === "error" && UNSAFE_CODES.has(item.code)).map(unsafeStep);
  const modelRequired = diagnostics
    .filter((item) => shouldRequireModel(item, repaired.applied))
    .map((item, index) => modelRequiredStep(item, index, deterministic.length + unsafe.length));

  return {
    version: "cypher-llm-repair-plan/v1",
    status: unsafe.length > 0 ? "blocked" : modelRequired.length > 0 ? "needs-model" : "ready",
    cypherBefore: renderQuery(query),
    cypherAfter: plan.cypher,
    deterministic,
    modelRequired,
    unsafe,
    diagnostics,
    summary: {
      deterministic: deterministic.length,
      modelRequired: modelRequired.length,
      unsafe: unsafe.length,
      diagnostics: diagnostics.length
    }
  };
}

function policyOptionsFromRepairPlanOptions(options: RepairPlanOptions): CypherPolicyOptions {
  return {
    ...(options.allowWrites !== undefined ? { allowWrites: options.allowWrites } : {}),
    ...(options.requireLimit !== undefined ? { requireLimit: options.requireLimit } : {}),
    ...(options.maxReturnLimit !== undefined ? { maxReturnLimit: options.maxReturnLimit } : {}),
    ...(options.maxRelationshipHops !== undefined ? { maxRelationshipHops: options.maxRelationshipHops } : {}),
    ...(options.maxEstimatedRows !== undefined ? { maxEstimatedRows: options.maxEstimatedRows } : {}),
    ...(options.maxDbHits !== undefined ? { maxDbHits: options.maxDbHits } : {}),
    ...(options.maxLabelScanRows !== undefined ? { maxLabelScanRows: options.maxLabelScanRows } : {}),
    ...(options.maxRelationshipFanout !== undefined ? { maxRelationshipFanout: options.maxRelationshipFanout } : {}),
    ...(options.warnOnPlanOperators !== undefined ? { warnOnPlanOperators: options.warnOnPlanOperators } : {}),
    ...(options.plannerEstimate !== undefined ? { plannerEstimate: options.plannerEstimate } : {}),
    ...(options.schemaStatistics !== undefined ? { schemaStatistics: options.schemaStatistics } : {}),
    ...(options.policyRules !== undefined ? { policyRules: options.policyRules } : {})
  };
}

function deterministicStep(repair: RepairAction, index: number): RepairPlanStep {
  return {
    id: `deterministic-${index + 1}-${repair.kind}`,
    class: "deterministic",
    rank: index + 1,
    title: titleForRepair(repair),
    path: repair.path,
    diagnostics: [],
    patch: {
      op: repair.before === undefined ? "add" : "replace",
      path: repair.path,
      value: repair.after
    },
    ...(repair.before !== undefined ? { before: repair.before } : {}),
    ...(repair.after !== undefined ? { after: repair.after } : {}),
    rationale: "Compiler can apply this repair without another model call."
  };
}

function modelRequiredStep(diagnosticItem: Diagnostic, index: number, rankOffset: number): RepairPlanStep {
  return {
    id: `model-required-${index + 1}-${diagnosticItem.code}`,
    class: "model-required",
    rank: rankOffset + index + 1,
    title: `Model must address ${diagnosticItem.code}`,
    ...(diagnosticItem.path ? { path: diagnosticItem.path } : {}),
    diagnostics: [diagnosticItem],
    rationale: diagnosticItem.suggestion ?? "Ask the model for corrected CypherQuery IR that satisfies this diagnostic."
  };
}

function unsafeStep(diagnosticItem: Diagnostic, index: number): RepairPlanStep {
  return {
    id: `unsafe-${index + 1}-${diagnosticItem.code}`,
    class: "unsafe",
    rank: 10_000 + index,
    title: `Unsafe or approval-gated query: ${diagnosticItem.code}`,
    ...(diagnosticItem.path ? { path: diagnosticItem.path } : {}),
    diagnostics: [diagnosticItem],
    rationale: diagnosticItem.suggestion ?? "Do not auto-repair this query without an explicit policy decision or approval."
  };
}

function shouldRequireModel(diagnosticItem: Diagnostic, repairs: RepairAction[]): boolean {
  if (diagnosticItem.severity !== "error" && !MODEL_REQUIRED_CODES.has(diagnosticItem.code)) {
    return false;
  }
  if (UNSAFE_CODES.has(diagnosticItem.code)) {
    return false;
  }
  if (diagnosticItem.repair && repairs.some((repair) => repair.kind === repairKindForHint(diagnosticItem.repair?.kind))) {
    return false;
  }
  return MODEL_REQUIRED_CODES.has(diagnosticItem.code) || diagnosticItem.severity === "error";
}

function repairKindForHint(kind: string | undefined): RepairAction["kind"] | undefined {
  switch (kind) {
    case "add-limit":
      return "add-limit";
    case "fix-direction":
      return "fix-direction";
    case "bound-path":
      return "bound-path";
    case "escape-identifier":
      return "canonicalize-identifier";
    default:
      return undefined;
  }
}

function titleForRepair(repair: RepairAction): string {
  switch (repair.kind) {
    case "canonicalize-identifier":
      return "Canonicalize schema identifier";
    case "add-limit":
      return "Add bounded LIMIT";
    case "fix-direction":
      return "Repair relationship direction";
    case "bound-path":
      return "Bound variable-length traversal";
    case "quote-raw-identifier":
      return "Quote raw schema identifier";
  }
}

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const unique: Diagnostic[] = [];
  for (const item of diagnostics) {
    const key = `${item.code}:${item.path ?? ""}:${item.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}
