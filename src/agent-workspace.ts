import {
  buildCypherAgentFeedback,
  type CypherAgentDiagnosticAction,
  type CypherAgentFeedback,
  type CypherAgentFeedbackOptions,
  type CypherAgentFeedbackStatus,
  type CypherAgentNextAction
} from "./agent-feedback.js";
import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import {
  buildLspDiagnostics,
  type LspCodeAction,
  type LspDiagnostic,
  type LspDiagnosticReport,
  type LspDiagnosticSeverity
} from "./lsp.js";
import type { RepairPlanStep, RepairPlanSourceAnchor } from "./repair-plan.js";

export interface CypherAgentWorkspaceOptions extends CypherAgentFeedbackOptions {
  uri?: string;
  generatedAt?: string;
}

export interface CypherAgentWorkspaceInstruction {
  source: "next-action" | "diagnostic-catalog" | "repair-plan";
  title: string;
  instruction: string;
  diagnosticCodes: string[];
  code?: string;
}

export interface CypherAgentWorkspaceQuickFix {
  title: string;
  kind: LspCodeAction["kind"];
  diagnosticCodes: string[];
}

export interface CypherAgentWorkspaceSourceAnchor {
  id: string;
  class: RepairPlanStep["class"];
  path?: string;
  sourceAnchor: RepairPlanSourceAnchor;
}

export interface CypherAgentWorkspaceSummary {
  diagnostics: number;
  errors: number;
  warnings: number;
  infos: number;
  codeActions: number;
  deterministicRepairs: number;
  modelRequired: number;
  unsafe: number;
  sourceAnchored: number;
  policyOk: boolean;
}

export interface CypherAgentWorkspace {
  version: "cypher-llm-agent-workspace/v1";
  generatedAt: string;
  uri: string;
  status: CypherAgentFeedbackStatus;
  canExecute: boolean;
  renderedCypher: string;
  nextAction: CypherAgentNextAction;
  summary: CypherAgentWorkspaceSummary;
  diagnosticCodes: string[];
  modelInstructions: CypherAgentWorkspaceInstruction[];
  editor: {
    languageId: LspDiagnosticReport["languageId"];
    quickFixes: CypherAgentWorkspaceQuickFix[];
    sourceAnchors: CypherAgentWorkspaceSourceAnchor[];
  };
  contracts: string[];
  lsp: LspDiagnosticReport;
  agentFeedback: CypherAgentFeedback;
}

const DEFAULT_GENERATED_AT = "2026-05-10";

export function buildCypherAgentWorkspace(
  query: CypherQuery,
  schema: CypherSchemaContract,
  params: Record<string, JsonLiteral> = {},
  options: CypherAgentWorkspaceOptions = {}
): CypherAgentWorkspace {
  const uri = options.uri ?? "file:///query.json";
  const lsp = buildLspDiagnostics(
    { schema, query },
    {
      uri,
      parserMode: options.parserMode ?? "syntax",
      ...(options.defaultLimit !== undefined ? { defaultLimit: options.defaultLimit } : {}),
      ...(options.defaultMaxHops !== undefined ? { defaultMaxHops: options.defaultMaxHops } : {})
    }
  );
  const agentFeedback = buildCypherAgentFeedback(query, schema, params, options);
  const allSteps = [
    ...agentFeedback.repairPlan.deterministic,
    ...agentFeedback.repairPlan.modelRequired,
    ...agentFeedback.repairPlan.unsafe
  ];

  const workspace: CypherAgentWorkspace = {
    version: "cypher-llm-agent-workspace/v1",
    generatedAt: options.generatedAt ?? DEFAULT_GENERATED_AT,
    uri,
    status: agentFeedback.status,
    canExecute: agentFeedback.canExecute,
    renderedCypher: lsp.renderedCypher,
    nextAction: agentFeedback.nextAction,
    summary: {
      diagnostics: lsp.diagnostics.length,
      errors: diagnosticsWithSeverity(lsp.diagnostics, 1),
      warnings: diagnosticsWithSeverity(lsp.diagnostics, 2),
      infos: diagnosticsWithSeverity(lsp.diagnostics, 3),
      codeActions: lsp.codeActions.length,
      deterministicRepairs: agentFeedback.repairPlan.deterministic.length,
      modelRequired: agentFeedback.repairPlan.modelRequired.length,
      unsafe: agentFeedback.repairPlan.unsafe.length,
      sourceAnchored: allSteps.filter((step) => step.sourceAnchor).length,
      policyOk: agentFeedback.policyEvidence.ok
    },
    diagnosticCodes: agentFeedback.diagnosticCodes,
    modelInstructions: workspaceInstructions(agentFeedback),
    editor: {
      languageId: lsp.languageId,
      quickFixes: quickFixes(lsp.codeActions),
      sourceAnchors: sourceAnchors(allSteps)
    },
    contracts: [
      "cypher-llm-agent-workspace/v1",
      "cypher-llm-agent-feedback/v1",
      "cypher-llm-lsp-diagnostics/v1",
      "cypher-llm-repair-plan/v1",
      "cypher-llm-proof/v1"
    ],
    lsp,
    agentFeedback
  };
  return JSON.parse(JSON.stringify(workspace)) as CypherAgentWorkspace;
}

function diagnosticsWithSeverity(diagnostics: LspDiagnostic[], severity: LspDiagnosticSeverity): number {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
}

function workspaceInstructions(feedback: CypherAgentFeedback): CypherAgentWorkspaceInstruction[] {
  return uniqueInstructions([
    {
      source: "next-action",
      title: feedback.nextAction.title,
      instruction: feedback.nextAction.reason,
      diagnosticCodes: feedback.nextAction.diagnosticCodes
    },
    ...feedback.diagnosticActions.map(instructionFromDiagnosticAction),
    ...feedback.repairPlan.modelRequired.map((step) => instructionFromRepairStep(step)),
    ...feedback.repairPlan.unsafe.map((step) => instructionFromRepairStep(step))
  ]);
}

function instructionFromDiagnosticAction(action: CypherAgentDiagnosticAction): CypherAgentWorkspaceInstruction {
  return {
    source: "diagnostic-catalog",
    title: action.title,
    instruction: action.modelInstruction,
    diagnosticCodes: [action.code],
    code: action.code
  };
}

function instructionFromRepairStep(step: RepairPlanStep): CypherAgentWorkspaceInstruction {
  return {
    source: "repair-plan",
    title: step.title,
    instruction: step.rationale,
    diagnosticCodes: step.diagnostics.map((diagnostic) => diagnostic.code)
  };
}

function quickFixes(actions: LspCodeAction[]): CypherAgentWorkspaceQuickFix[] {
  return actions.map((action) => ({
    title: action.title,
    kind: action.kind,
    diagnosticCodes: unique(action.diagnostics.map((diagnostic) => diagnostic.code))
  }));
}

function sourceAnchors(steps: RepairPlanStep[]): CypherAgentWorkspaceSourceAnchor[] {
  return steps.flatMap((step) => {
    if (!step.sourceAnchor) {
      return [];
    }
    return [
      {
        id: step.id,
        class: step.class,
        ...(step.path ? { path: step.path } : {}),
        sourceAnchor: step.sourceAnchor
      }
    ];
  });
}

function uniqueInstructions(instructions: CypherAgentWorkspaceInstruction[]): CypherAgentWorkspaceInstruction[] {
  const seen = new Set<string>();
  const result: CypherAgentWorkspaceInstruction[] = [];
  for (const instruction of instructions) {
    const key = `${instruction.source}\0${instruction.title}\0${instruction.instruction}\0${instruction.diagnosticCodes.join(",")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(instruction);
  }
  return result;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
