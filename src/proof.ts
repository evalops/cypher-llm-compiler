import type { Diagnostic } from "./diagnostics.js";
import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import type { ParserValidationOptions } from "./parser-validation.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import { type SafeExecutionOptions, createSafeExecutionPlan } from "./safety.js";

export type CypherProofStatus = "accepted" | "accepted-with-warnings" | "repaired" | "blocked";
export type CypherProofClaimStatus = "passed" | "warning" | "failed";

export interface CypherProofOptions extends SafeExecutionOptions {
  parserMode?: ParserValidationOptions["mode"];
  includeParser?: boolean;
}

export interface CypherProofClaim {
  id: string;
  title: string;
  status: CypherProofClaimStatus;
  evidence: string[];
  diagnostics: Diagnostic[];
}

export interface CypherProof {
  version: "cypher-llm-proof/v1";
  status: CypherProofStatus;
  dialect?: string;
  mode: string;
  cypher: string;
  preflightCypher: string;
  canExecute: boolean;
  requiresApproval: boolean;
  repairKinds: string[];
  diagnosticCodes: string[];
  claims: CypherProofClaim[];
}

export function buildCypherProof(
  query: CypherQuery,
  schema: CypherSchemaContract,
  params: Record<string, JsonLiteral> = {},
  options: CypherProofOptions = {}
): CypherProof {
  const plan = createSafeExecutionPlan(query, schema, params, options);
  const planDiagnostics = plan.diagnostics;
  const claims: CypherProofClaim[] = [
    {
      id: "deterministic-repair",
      title: "Deterministic compiler repairs are recorded before rendering",
      status: plan.repairs.length > 0 ? "warning" : "passed",
      evidence: ["src/repair.ts", "src/safety.ts"],
      diagnostics: plan.repairs.length > 0 ? planDiagnostics.filter((diagnostic) => diagnostic.repair) : []
    },
    {
      id: "compiler-diagnostics",
      title: "Compiler diagnostics have no blocking errors",
      status: claimStatus(planDiagnostics),
      evidence: ["src/validate.ts", "src/safety.ts"],
      diagnostics: planDiagnostics
    },
    {
      id: "execution-policy",
      title: "Execution policy allows this plan to run",
      status: plan.canExecute && !plan.requiresApproval ? "passed" : "failed",
      evidence: ["src/safety.ts", "docs/LLM_SAFE_PROFILE.md"],
      diagnostics: planDiagnostics.filter((diagnostic) =>
        ["execution-approval-required", "write-requires-approval", "missing-required-parameter"].includes(diagnostic.code)
      )
    }
  ];

  if (options.includeParser !== false) {
    const parser = validateCypherTextWithParser(plan.cypher, schema, { mode: options.parserMode ?? "syntax" });
    claims.push({
      id: "parser-preflight",
      title: "Rendered Cypher is accepted by parser preflight",
      status: claimStatus(parser.diagnostics),
      evidence: ["src/parser-validation.ts"],
      diagnostics: parser.diagnostics
    });
  }

  const diagnosticCodes = unique(claims.flatMap((claim) => claim.diagnostics.map((diagnostic) => diagnostic.code)));
  const repairKinds = unique(plan.repairs.map((repair) => repair.kind));

  return {
    version: "cypher-llm-proof/v1",
    status: proofStatus(claims, repairKinds),
    ...(schema.dialect ? { dialect: schema.dialect } : {}),
    mode: plan.mode,
    cypher: plan.cypher,
    preflightCypher: plan.preflightCypher,
    canExecute: plan.canExecute,
    requiresApproval: plan.requiresApproval,
    repairKinds,
    diagnosticCodes,
    claims
  };
}

function claimStatus(diagnostics: Diagnostic[]): CypherProofClaimStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "failed";
  }
  if (diagnostics.length > 0) {
    return "warning";
  }
  return "passed";
}

function proofStatus(claims: CypherProofClaim[], repairKinds: string[]): CypherProofStatus {
  if (claims.some((claim) => claim.status === "failed")) {
    return "blocked";
  }
  if (repairKinds.length > 0) {
    return "repaired";
  }
  if (claims.some((claim) => claim.status === "warning")) {
    return "accepted-with-warnings";
  }
  return "accepted";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
