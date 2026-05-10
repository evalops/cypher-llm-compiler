import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import type { CypherPolicyEvidence } from "./policy.js";
import { buildCypherProof, type CypherProof, type CypherProofOptions } from "./proof.js";
import { buildCypherRepairPlan, type CypherRepairPlan, type RepairPlanOptions } from "./repair-plan.js";

export type CypherAgentFeedbackStatus = "ready" | "repaired" | "needs-model" | "blocked";
export type CypherAgentNextActionKind =
  | "execute"
  | "apply-deterministic-repairs"
  | "regenerate-query"
  | "request-approval"
  | "blocked";

export interface CypherAgentNextAction {
  kind: CypherAgentNextActionKind;
  title: string;
  reason: string;
  diagnosticCodes: string[];
}

export interface CypherAgentFeedbackOptions extends CypherProofOptions {}

export interface CypherAgentFeedback {
  version: "cypher-llm-agent-feedback/v1";
  status: CypherAgentFeedbackStatus;
  canExecute: boolean;
  nextAction: CypherAgentNextAction;
  diagnosticCodes: string[];
  repairKinds: string[];
  policyEvidence: CypherPolicyEvidence;
  proof: CypherProof;
  repairPlan: CypherRepairPlan;
}

const APPROVAL_CODES = new Set(["execution-approval-required", "write-requires-approval", "policy-write-risk"]);

export function buildCypherAgentFeedback(
  query: CypherQuery,
  schema: CypherSchemaContract,
  params: Record<string, JsonLiteral> = {},
  options: CypherAgentFeedbackOptions = {}
): CypherAgentFeedback {
  const proof = buildCypherProof(query, schema, params, options);
  const repairPlan = buildCypherRepairPlan(query, schema, repairPlanOptionsFromFeedback(options, params));
  const diagnosticCodes = unique([
    ...proof.diagnosticCodes,
    ...repairPlan.diagnostics.map((diagnostic) => diagnostic.code)
  ]);
  const repairKinds = unique(proof.repairKinds);
  const status = feedbackStatus(proof, repairPlan);

  return {
    version: "cypher-llm-agent-feedback/v1",
    status,
    canExecute: proof.canExecute,
    nextAction: nextActionFor(status, proof, repairPlan, diagnosticCodes),
    diagnosticCodes,
    repairKinds,
    policyEvidence: proof.policyEvidence,
    proof,
    repairPlan
  };
}

function repairPlanOptionsFromFeedback(
  options: CypherAgentFeedbackOptions,
  params: Record<string, JsonLiteral>
): RepairPlanOptions {
  return {
    params,
    ...(options.defaultLimit !== undefined ? { defaultLimit: options.defaultLimit } : {}),
    ...(options.defaultMaxHops !== undefined ? { defaultMaxHops: options.defaultMaxHops } : {}),
    ...(options.parserMode !== undefined ? { parserMode: options.parserMode } : {}),
    ...(options.allowWrites !== undefined ? { allowWrites: options.allowWrites } : {}),
    ...(options.approved !== undefined ? { approved: options.approved } : {}),
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

function feedbackStatus(proof: CypherProof, repairPlan: CypherRepairPlan): CypherAgentFeedbackStatus {
  if (repairPlan.status === "blocked" || proof.status === "blocked") {
    return "blocked";
  }
  if (repairPlan.status === "needs-model") {
    return "needs-model";
  }
  if (proof.repairKinds.length > 0 || repairPlan.deterministic.length > 0) {
    return "repaired";
  }
  return "ready";
}

function nextActionFor(
  status: CypherAgentFeedbackStatus,
  proof: CypherProof,
  repairPlan: CypherRepairPlan,
  diagnosticCodes: string[]
): CypherAgentNextAction {
  if (status === "ready") {
    return {
      kind: "execute",
      title: "Execute the compiled Cypher",
      reason: "Proof claims passed and no deterministic repairs are pending.",
      diagnosticCodes: []
    };
  }

  if (status === "repaired") {
    return {
      kind: "apply-deterministic-repairs",
      title: "Apply deterministic repairs, then execute",
      reason: "The compiler produced a safe repaired query without requiring another model call.",
      diagnosticCodes: repairPlan.diagnostics.filter((diagnostic) => diagnostic.repair).map((diagnostic) => diagnostic.code)
    };
  }

  if (status === "needs-model") {
    return {
      kind: "regenerate-query",
      title: "Regenerate the CypherQuery IR",
      reason: "The remaining diagnostics require semantic choices from the model.",
      diagnosticCodes: unique(repairPlan.modelRequired.flatMap((step) => step.diagnostics.map((diagnostic) => diagnostic.code)))
    };
  }

  if (diagnosticCodes.some((code) => APPROVAL_CODES.has(code))) {
    return {
      kind: "request-approval",
      title: "Request approval or policy override",
      reason: "The query is blocked by write or approval policy.",
      diagnosticCodes: diagnosticCodes.filter((code) => APPROVAL_CODES.has(code))
    };
  }

  return {
    kind: "blocked",
    title: "Stop before execution",
    reason: "The query has unsafe policy or execution blockers.",
    diagnosticCodes
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
