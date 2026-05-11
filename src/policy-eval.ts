import type { EvalAttempt, EvalAttemptSet, EvalDataset, EvalTask } from "./evals.js";
import type { CypherQuery, JsonLiteral } from "./ir.js";
import {
  assessCypherPolicy,
  type CypherPolicyFinding,
  type CypherPolicyOptions,
  type CypherPolicyPlannerSummary,
  type CypherPolicyProfileRef,
  type CypherPolicyStatisticsSummary,
  type CypherPolicySummary
} from "./policy.js";
import type { CypherPolicyRuleSetSummary } from "./policy-rules.js";
import { liftRawCypherToIr } from "./raw-lift.js";
import { repairQuery } from "./repair.js";
import type { RepairOptions } from "./repair.js";
import { createSafeExecutionPlan } from "./safety.js";

export type CypherPolicyEvalAttemptKind = "ir" | "raw" | "no-cypher" | "timeout" | "missing";
export type CypherPolicyEvalStatus = "passed" | "warning" | "blocked" | "not-evaluated";

export interface CypherPolicyEvalOptions extends CypherPolicyOptions, RepairOptions {
  parserMode?: "syntax" | "lint";
}

export interface CypherPolicyEvalReport {
  version: "cypher-llm-policy-eval/v1";
  generatedAt: string;
  datasetName: string;
  model?: string;
  prompt?: string;
  policy?: CypherPolicyProfileRef;
  rules?: CypherPolicyRuleSetSummary;
  planner?: CypherPolicyPlannerSummary;
  statistics?: CypherPolicyStatisticsSummary;
  summary: CypherPolicyEvalSummary;
  results: CypherPolicyEvalResult[];
}

export interface CypherPolicyEvalSummary {
  totalTasks: number;
  evaluatedAttempts: number;
  missingAttempts: number;
  noCypherAttempts: number;
  timeoutAttempts: number;
  irAttempts: number;
  rawAttempts: number;
  passedAttempts: number;
  warningAttempts: number;
  blockedAttempts: number;
  notEvaluatedAttempts: number;
  compilerExecutableAttempts: number;
  riskyExecutableAttempts: number;
  findings: number;
  errors: number;
  warnings: number;
  infos: number;
  findingsByCode: Record<string, number>;
  diagnosticsByCode: Record<string, number>;
  policyPassRate: number;
  blockedRate: number;
}

export interface CypherPolicyEvalResult {
  taskId: string;
  question: string;
  kind: CypherPolicyEvalAttemptKind;
  status: CypherPolicyEvalStatus;
  canEvaluate: boolean;
  policyOk: boolean;
  compilerCanExecute: boolean;
  cypher?: string;
  repairs: string[];
  diagnostics: string[];
  summary: CypherPolicySummary;
  findings: CypherPolicyFinding[];
}

export function evaluatePolicyAttempts(
  dataset: EvalDataset,
  attemptSet: EvalAttemptSet,
  options: CypherPolicyEvalOptions = {}
): CypherPolicyEvalReport {
  const attemptsByTask = new Map(attemptSet.attempts.map((attempt) => [attempt.taskId, attempt]));
  const results = dataset.tasks.map((task) => evaluatePolicyTask(task, attemptsByTask.get(task.id), options));
  const metadata = policyMetadata(dataset, options);
  return {
    version: "cypher-llm-policy-eval/v1",
    generatedAt: "2026-05-10",
    datasetName: dataset.name,
    ...(attemptSet.model ? { model: attemptSet.model } : {}),
    ...(attemptSet.prompt ? { prompt: attemptSet.prompt } : {}),
    ...(options.profile ? { policy: options.profile } : {}),
    ...(metadata.rules ? { rules: metadata.rules } : {}),
    ...(metadata.planner ? { planner: metadata.planner } : {}),
    ...(metadata.statistics ? { statistics: metadata.statistics } : {}),
    summary: summarize(results),
    results
  };
}

function evaluatePolicyTask(
  task: EvalTask,
  attempt: EvalAttempt | undefined,
  options: CypherPolicyEvalOptions
): CypherPolicyEvalResult {
  if (!attempt) {
    return terminalResult(task, "missing", "missing-attempt");
  }
  if (attempt.timeout) {
    return terminalResult(task, "timeout", "timeout");
  }
  if (attempt.noCypher) {
    return terminalResult(task, "no-cypher", "no-cypher-output");
  }
  if (attempt.query) {
    return evaluateIrPolicyTask(task, attempt.query, { ...(task.params ?? {}), ...(attempt.params ?? {}) }, options);
  }
  if (attempt.rawCypher) {
    return evaluateRawPolicyTask(task, attempt.rawCypher, { ...(task.params ?? {}), ...(attempt.params ?? {}) }, options);
  }
  return terminalResult(task, "missing", "empty-attempt");
}

function evaluateIrPolicyTask(
  task: EvalTask,
  query: CypherQuery,
  params: Record<string, JsonLiteral>,
  options: CypherPolicyEvalOptions
): CypherPolicyEvalResult {
  const policy = assessCypherPolicy(query, task.schema, options);
  const repaired = repairQuery(query, task.schema, options);
  const plan = createSafeExecutionPlan(repaired.query, task.schema, params, {
    ...(options.defaultLimit !== undefined ? { defaultLimit: options.defaultLimit } : {}),
    ...(options.defaultMaxHops !== undefined ? { defaultMaxHops: options.defaultMaxHops } : {}),
    ...(options.allowWrites !== undefined ? { allowWrites: options.allowWrites } : {})
  });
  const diagnostics = unique([...repaired.diagnostics.map((item) => item.code), ...plan.diagnostics.map((item) => item.code)]);
  const repairs = unique([...repaired.applied.map((item) => item.kind), ...plan.repairs.map((item) => item.kind)]);

  return policyResult(task, "ir", policy, plan.canExecute, plan.cypher, repairs, diagnostics);
}

function evaluateRawPolicyTask(
  task: EvalTask,
  rawCypher: string,
  params: Record<string, JsonLiteral>,
  options: CypherPolicyEvalOptions
): CypherPolicyEvalResult {
  const lifted = liftRawCypherToIr(rawCypher, task.schema, {
    profile: "raw-compatible",
    parserMode: options.parserMode ?? "syntax"
  });
  const diagnostics = unique(lifted.diagnostics.map((item) => item.code));
  if (lifted.rawClauses > 0) {
    return {
      taskId: task.id,
      question: task.question,
      kind: "raw",
      status: "not-evaluated",
      canEvaluate: false,
      policyOk: false,
      compilerCanExecute: false,
      cypher: lifted.renderedCypher,
      repairs: [],
      diagnostics,
      summary: emptySummary(),
      findings: []
    };
  }

  const policy = assessCypherPolicy(lifted.query, task.schema, options);
  const plan = createSafeExecutionPlan(lifted.query, task.schema, params, {
    ...(options.defaultLimit !== undefined ? { defaultLimit: options.defaultLimit } : {}),
    ...(options.defaultMaxHops !== undefined ? { defaultMaxHops: options.defaultMaxHops } : {}),
    ...(options.allowWrites !== undefined ? { allowWrites: options.allowWrites } : {})
  });
  return policyResult(
    task,
    "raw",
    policy,
    plan.canExecute,
    plan.cypher,
    unique(plan.repairs.map((item) => item.kind)),
    unique([...diagnostics, ...plan.diagnostics.map((item) => item.code)])
  );
}

function policyResult(
  task: EvalTask,
  kind: "ir" | "raw",
  policy: ReturnType<typeof assessCypherPolicy>,
  compilerCanExecute: boolean,
  cypher: string,
  repairs: string[],
  diagnostics: string[]
): CypherPolicyEvalResult {
  return {
    taskId: task.id,
    question: task.question,
    kind,
    status: statusFor(policy.summary),
    canEvaluate: true,
    policyOk: policy.ok,
    compilerCanExecute,
    cypher,
    repairs,
    diagnostics,
    summary: policy.summary,
    findings: policy.findings
  };
}

function terminalResult(
  task: EvalTask,
  kind: "missing" | "no-cypher" | "timeout",
  diagnosticCode: string
): CypherPolicyEvalResult {
  return {
    taskId: task.id,
    question: task.question,
    kind,
    status: "not-evaluated",
    canEvaluate: false,
    policyOk: false,
    compilerCanExecute: false,
    repairs: [],
    diagnostics: [diagnosticCode],
    summary: emptySummary(),
    findings: []
  };
}

function summarize(results: CypherPolicyEvalResult[]): CypherPolicyEvalSummary {
  const evaluated = results.filter((result) => result.canEvaluate);
  const blocked = results.filter((result) => result.status === "blocked").length;
  const passed = results.filter((result) => result.status === "passed").length;
  return {
    totalTasks: results.length,
    evaluatedAttempts: evaluated.length,
    missingAttempts: results.filter((result) => result.kind === "missing").length,
    noCypherAttempts: results.filter((result) => result.kind === "no-cypher").length,
    timeoutAttempts: results.filter((result) => result.kind === "timeout").length,
    irAttempts: results.filter((result) => result.kind === "ir").length,
    rawAttempts: results.filter((result) => result.kind === "raw").length,
    passedAttempts: passed,
    warningAttempts: results.filter((result) => result.status === "warning").length,
    blockedAttempts: blocked,
    notEvaluatedAttempts: results.filter((result) => result.status === "not-evaluated").length,
    compilerExecutableAttempts: results.filter((result) => result.compilerCanExecute).length,
    riskyExecutableAttempts: results.filter((result) => result.compilerCanExecute && result.status !== "passed").length,
    findings: results.reduce((sum, result) => sum + result.summary.findings, 0),
    errors: results.reduce((sum, result) => sum + result.summary.errors, 0),
    warnings: results.reduce((sum, result) => sum + result.summary.warnings, 0),
    infos: results.reduce((sum, result) => sum + result.summary.infos, 0),
    findingsByCode: countFindings(results),
    diagnosticsByCode: countDiagnostics(results),
    policyPassRate: rate(passed, evaluated.length),
    blockedRate: rate(blocked, evaluated.length)
  };
}

function policyMetadata(dataset: EvalDataset, options: CypherPolicyEvalOptions) {
  const task = dataset.tasks[0];
  if (!task) {
    return {} as Pick<ReturnType<typeof assessCypherPolicy>, "rules" | "planner" | "statistics">;
  }
  return assessCypherPolicy({ version: "cypher-llm-ir/v1", clauses: [] }, task.schema, options);
}

function statusFor(summary: CypherPolicySummary): CypherPolicyEvalStatus {
  if (summary.errors > 0) {
    return "blocked";
  }
  if (summary.warnings > 0 || summary.infos > 0) {
    return "warning";
  }
  return "passed";
}

function emptySummary(): CypherPolicySummary {
  return {
    findings: 0,
    errors: 0,
    warnings: 0,
    infos: 0
  };
}

function countFindings(results: CypherPolicyEvalResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const finding of result.findings) {
      counts[finding.code] = (counts[finding.code] ?? 0) + 1;
    }
  }
  return sortedCounts(counts);
}

function countDiagnostics(results: CypherPolicyEvalResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const diagnostic of result.diagnostics) {
      counts[diagnostic] = (counts[diagnostic] ?? 0) + 1;
    }
  }
  return sortedCounts(counts);
}

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
