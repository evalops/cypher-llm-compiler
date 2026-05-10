import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import { renderQuery } from "./render.js";
import { repairQuery, repairRawCypher, type RepairAction, type RepairOptions } from "./repair.js";
import { createSafeExecutionPlan } from "./safety.js";
import { normalizeSchema } from "./schema.js";
import { validateQuery } from "./validate.js";

export interface EvalDataset {
  version: "cypher-llm-eval-dataset/v1";
  name: string;
  description?: string;
  tasks: EvalTask[];
}

export interface EvalTask {
  id: string;
  question: string;
  source?: string;
  tags?: string[];
  schema: CypherSchemaContract;
  params?: Record<string, JsonLiteral>;
  expected?: EvalExpectation;
}

export interface EvalExpectation {
  cypherContains?: string[];
  diagnosticCodes?: string[];
  repairKinds?: string[];
  canExecute?: boolean;
}

export interface EvalAttemptSet {
  version: "cypher-llm-eval-attempts/v1";
  datasetName?: string;
  model?: string;
  prompt?: string;
  attempts: EvalAttempt[];
}

export interface EvalAttempt {
  taskId: string;
  model?: string;
  prompt?: string;
  query?: CypherQuery;
  rawCypher?: string;
  params?: Record<string, JsonLiteral>;
}

export interface EvalOptions extends RepairOptions {
  rawCypherCanExecute?: boolean;
}

export interface EvalReport {
  version: "cypher-llm-eval-report/v1";
  datasetName: string;
  model?: string;
  prompt?: string;
  metrics: EvalMetrics;
  results: EvalResult[];
}

export interface EvalMetrics {
  totalTasks: number;
  attemptedTasks: number;
  missingAttempts: number;
  passedTasks: number;
  failedTasks: number;
  irAttempts: number;
  rawAttempts: number;
  executablePlans: number;
  repairApplied: number;
  expectedCypherMatches: number;
  expectedDiagnosticMatches: number;
  diagnosticsByCode: Record<string, number>;
  passRate: number;
  executableRate: number;
  repairRate: number;
}

export interface EvalResult {
  taskId: string;
  question: string;
  kind: "ir" | "raw" | "missing";
  passed: boolean;
  cypher?: string;
  canExecute: boolean;
  diagnostics: string[];
  repairs: string[];
  expectationResults: ExpectationResult[];
}

export interface ExpectationResult {
  kind: "cypher-contains" | "diagnostic-code" | "repair-kind" | "can-execute";
  expected: string | boolean;
  passed: boolean;
}

export function evaluateAttempts(
  dataset: EvalDataset,
  attemptSet: EvalAttemptSet,
  options: EvalOptions = {}
): EvalReport {
  const attemptsByTask = new Map(attemptSet.attempts.map((attempt) => [attempt.taskId, attempt]));
  const results = dataset.tasks.map((task) => evaluateTask(task, attemptsByTask.get(task.id), options));
  return {
    version: "cypher-llm-eval-report/v1",
    datasetName: dataset.name,
    ...(attemptSet.model ? { model: attemptSet.model } : {}),
    ...(attemptSet.prompt ? { prompt: attemptSet.prompt } : {}),
    metrics: computeMetrics(results),
    results
  };
}

function evaluateTask(task: EvalTask, attempt: EvalAttempt | undefined, options: EvalOptions): EvalResult {
  if (!attempt) {
    return {
      taskId: task.id,
      question: task.question,
      kind: "missing",
      passed: false,
      canExecute: false,
      diagnostics: ["missing-attempt"],
      repairs: [],
      expectationResults: expectationResults(undefined, false, ["missing-attempt"], [], task.expected)
    };
  }

  if (attempt.query) {
    return evaluateIrAttempt(task, attempt, options);
  }

  if (attempt.rawCypher) {
    return evaluateRawAttempt(task, attempt, options);
  }

  return {
    taskId: task.id,
    question: task.question,
    kind: "missing",
    passed: false,
    canExecute: false,
    diagnostics: ["empty-attempt"],
    repairs: [],
    expectationResults: expectationResults(undefined, false, ["empty-attempt"], [], task.expected)
  };
}

function evaluateIrAttempt(task: EvalTask, attempt: EvalAttempt, options: EvalOptions): EvalResult {
  const schema = normalizeSchema(task.schema);
  const query = attempt.query as CypherQuery;
  const params = { ...(task.params ?? {}), ...(attempt.params ?? {}) };
  const beforeRepair = validateQuery(query, schema);
  const repair = repairQuery(query, schema, options);
  const plan = createSafeExecutionPlan(repair.query, schema, params, options);
  const diagnostics = unique([
    ...beforeRepair.diagnostics.map((item) => item.code),
    ...repair.diagnostics.map((item) => item.code),
    ...plan.diagnostics.map((item) => item.code)
  ]);
  const repairs = unique([...repair.applied.map((item) => item.kind), ...plan.repairs.map((item) => item.kind)]);
  const expectations = expectationResults(plan.cypher, plan.canExecute, diagnostics, repairs, task.expected);

  return {
    taskId: task.id,
    question: task.question,
    kind: "ir",
    passed: expectations.every((item) => item.passed),
    cypher: plan.cypher,
    canExecute: plan.canExecute,
    diagnostics,
    repairs,
    expectationResults: expectations
  };
}

function evaluateRawAttempt(task: EvalTask, attempt: EvalAttempt, options: EvalOptions): EvalResult {
  const schema = normalizeSchema(task.schema);
  const raw = attempt.rawCypher as string;
  const repair = repairRawCypher(raw, schema);
  const diagnostics = unique(repair.diagnostics.map((item) => item.code));
  const repairs = unique(repair.applied.map((item: RepairAction) => item.kind));
  const canExecute = options.rawCypherCanExecute === true && !diagnostics.some((code) => code === "no-cypher-output");
  const expectations = expectationResults(repair.cypher, canExecute, diagnostics, repairs, task.expected);

  return {
    taskId: task.id,
    question: task.question,
    kind: "raw",
    passed: expectations.every((item) => item.passed),
    cypher: repair.cypher,
    canExecute,
    diagnostics,
    repairs,
    expectationResults: expectations
  };
}

function expectationResults(
  cypher: string | undefined,
  canExecute: boolean,
  diagnostics: string[],
  repairs: string[],
  expected: EvalExpectation | undefined
): ExpectationResult[] {
  const results: ExpectationResult[] = [];
  for (const fragment of expected?.cypherContains ?? []) {
    results.push({
      kind: "cypher-contains",
      expected: fragment,
      passed: cypher?.includes(fragment) ?? false
    });
  }
  for (const code of expected?.diagnosticCodes ?? []) {
    results.push({
      kind: "diagnostic-code",
      expected: code,
      passed: diagnostics.includes(code)
    });
  }
  for (const repairKind of expected?.repairKinds ?? []) {
    results.push({
      kind: "repair-kind",
      expected: repairKind,
      passed: repairs.includes(repairKind)
    });
  }
  if (expected?.canExecute !== undefined) {
    results.push({
      kind: "can-execute",
      expected: expected.canExecute,
      passed: canExecute === expected.canExecute
    });
  }
  return results;
}

function computeMetrics(results: EvalResult[]): EvalMetrics {
  const totalTasks = results.length;
  const missingAttempts = results.filter((result) => result.kind === "missing").length;
  const attemptedTasks = totalTasks - missingAttempts;
  const passedTasks = results.filter((result) => result.passed).length;
  const failedTasks = totalTasks - passedTasks;
  const irAttempts = results.filter((result) => result.kind === "ir").length;
  const rawAttempts = results.filter((result) => result.kind === "raw").length;
  const executablePlans = results.filter((result) => result.canExecute).length;
  const repairApplied = results.filter((result) => result.repairs.length > 0).length;
  const expectedCypherMatches = countExpectationPasses(results, "cypher-contains");
  const expectedDiagnosticMatches = countExpectationPasses(results, "diagnostic-code");
  const diagnosticsByCode = countDiagnostics(results);

  return {
    totalTasks,
    attemptedTasks,
    missingAttempts,
    passedTasks,
    failedTasks,
    irAttempts,
    rawAttempts,
    executablePlans,
    repairApplied,
    expectedCypherMatches,
    expectedDiagnosticMatches,
    diagnosticsByCode,
    passRate: ratio(passedTasks, totalTasks),
    executableRate: ratio(executablePlans, totalTasks),
    repairRate: ratio(repairApplied, attemptedTasks)
  };
}

function countExpectationPasses(results: EvalResult[], kind: ExpectationResult["kind"]): number {
  return results.flatMap((result) => result.expectationResults).filter((result) => result.kind === kind && result.passed)
    .length;
}

function countDiagnostics(results: EvalResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const code of result.diagnostics) {
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
