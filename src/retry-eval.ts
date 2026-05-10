import type { EvalAttemptSet, EvalDataset, EvalOptions, EvalReport, EvalResult } from "./evals.js";
import { evaluateAttempts } from "./evals.js";
import { repairFeedbackPackets } from "./repair-loop.js";

export interface RetryEvalRoundInput {
  id?: string;
  label?: string;
  attempts: EvalAttemptSet;
}

export interface RetryEvalReport {
  version: "cypher-llm-retry-eval/v1";
  datasetName: string;
  generatedAt: string;
  summary: RetryEvalSummary;
  rounds: RetryEvalRoundReport[];
  transitions: RetryEvalTransitionReport[];
  tasks: RetryEvalTaskReport[];
}

export interface RetryEvalSummary {
  totalTasks: number;
  rounds: number;
  totalAttempts: number;
  initialPassedTasks: number;
  finalPassedTasks: number;
  deltaPassedTasks: number;
  initialPassRate: number;
  finalPassRate: number;
  deltaPassRate: number;
  finalExecutableRate: number;
  alreadyPassedTasks: number;
  convergedTasks: number;
  improvedTasks: number;
  regressedTasks: number;
  unresolvedTasks: number;
  retryPacketsGenerated: number;
  retryPacketsResolvedNextRound: number;
  retryPacketResolutionRate: number;
  averageRoundsToPass: number;
  diagnosticsRemaining: Record<string, number>;
  models: string[];
}

export interface RetryEvalRoundReport {
  id: string;
  label?: string;
  index: number;
  model?: string;
  prompt?: string;
  evalReport: EvalReport;
}

export interface RetryEvalTransitionReport {
  fromRoundId: string;
  toRoundId: string;
  failedTasksBefore: number;
  passedTasksAfter: number;
  improvedTasks: number;
  regressedTasks: number;
  retryPacketsGenerated: number;
  retryPacketsResolved: number;
  retryPacketResolutionRate: number;
  diagnosticsAddressed: Record<string, number>;
  diagnosticsIntroduced: Record<string, number>;
}

export type RetryEvalTaskStatus = "already-passed" | "converged" | "improved" | "regressed" | "unresolved";

export interface RetryEvalTaskReport {
  taskId: string;
  question: string;
  status: RetryEvalTaskStatus;
  firstPassingRoundId?: string;
  finalRoundId: string;
  initial: RetryEvalTaskRoundResult;
  final: RetryEvalTaskRoundResult;
  attempts: RetryEvalTaskRoundResult[];
}

export interface RetryEvalTaskRoundResult {
  roundId: string;
  kind: EvalResult["kind"];
  passed: boolean;
  canExecute: boolean;
  diagnostics: string[];
  repairs: string[];
  failedExpectations: number;
  qualityScore: number;
}

export interface RetryEvalOptions extends EvalOptions {
  generatedAt?: string;
}

export function evaluateRetryAttempts(
  dataset: EvalDataset,
  rounds: RetryEvalRoundInput[],
  options: RetryEvalOptions = {}
): RetryEvalReport {
  if (rounds.length === 0) {
    throw new Error("Retry eval requires at least one attempt round.");
  }

  const normalizedRounds = normalizeRounds(rounds);
  const roundReports = normalizedRounds.map((round, index): RetryEvalRoundReport => {
    const evalReport = evaluateAttempts(dataset, round.attempts, options);
    return {
      id: round.id,
      ...(round.label ? { label: round.label } : {}),
      index,
      ...(round.attempts.model ? { model: round.attempts.model } : {}),
      ...(round.attempts.prompt ? { prompt: round.attempts.prompt } : {}),
      evalReport
    };
  });
  const transitions = buildTransitions(dataset, roundReports);
  const tasks = buildTaskReports(dataset, roundReports);
  return {
    version: "cypher-llm-retry-eval/v1",
    datasetName: dataset.name,
    generatedAt: options.generatedAt ?? "2026-05-10",
    summary: buildSummary(dataset, roundReports, transitions, tasks),
    rounds: roundReports,
    transitions,
    tasks
  };
}

function normalizeRounds(rounds: RetryEvalRoundInput[]): Array<Required<Pick<RetryEvalRoundInput, "attempts">> & { id: string; label?: string }> {
  const seen = new Set<string>();
  return rounds.map((round, index) => {
    const id = round.id?.trim() || `round-${index + 1}`;
    if (seen.has(id)) {
      throw new Error(`Duplicate retry eval round id '${id}'.`);
    }
    seen.add(id);
    return {
      id,
      ...(round.label ? { label: round.label } : {}),
      attempts: round.attempts
    };
  });
}

function buildTransitions(dataset: EvalDataset, rounds: RetryEvalRoundReport[]): RetryEvalTransitionReport[] {
  const transitions: RetryEvalTransitionReport[] = [];
  for (let index = 0; index < rounds.length - 1; index += 1) {
    const before = rounds[index] as RetryEvalRoundReport;
    const after = rounds[index + 1] as RetryEvalRoundReport;
    const beforeByTask = resultsByTask(before.evalReport);
    const afterByTask = resultsByTask(after.evalReport);
    const packets = repairFeedbackPackets(dataset, before.evalReport);
    const retryPacketsResolved = packets.filter((packet) => afterByTask.get(packet.taskId)?.passed === true).length;
    const failedTasksBefore = before.evalReport.results.filter((result) => !result.passed).length;
    const passedTasksAfter = packets.filter((packet) => afterByTask.get(packet.taskId)?.passed === true).length;
    let improvedTasks = 0;
    let regressedTasks = 0;
    const diagnosticsAddressed: Record<string, number> = {};
    const diagnosticsIntroduced: Record<string, number> = {};

    for (const task of dataset.tasks) {
      const left = beforeByTask.get(task.id);
      const right = afterByTask.get(task.id);
      if (!left || !right) {
        continue;
      }
      const leftScore = qualityScore(left);
      const rightScore = qualityScore(right);
      if (rightScore > leftScore) {
        improvedTasks += 1;
      } else if (rightScore < leftScore) {
        regressedTasks += 1;
      }
      for (const code of left.diagnostics) {
        if (!right.diagnostics.includes(code)) {
          diagnosticsAddressed[code] = (diagnosticsAddressed[code] ?? 0) + 1;
        }
      }
      for (const code of right.diagnostics) {
        if (!left.diagnostics.includes(code)) {
          diagnosticsIntroduced[code] = (diagnosticsIntroduced[code] ?? 0) + 1;
        }
      }
    }

    transitions.push({
      fromRoundId: before.id,
      toRoundId: after.id,
      failedTasksBefore,
      passedTasksAfter,
      improvedTasks,
      regressedTasks,
      retryPacketsGenerated: packets.length,
      retryPacketsResolved,
      retryPacketResolutionRate: ratio(retryPacketsResolved, packets.length),
      diagnosticsAddressed: sortedCounts(diagnosticsAddressed),
      diagnosticsIntroduced: sortedCounts(diagnosticsIntroduced)
    });
  }
  return transitions;
}

function buildTaskReports(dataset: EvalDataset, rounds: RetryEvalRoundReport[]): RetryEvalTaskReport[] {
  return dataset.tasks.map((task) => {
    const attempts = rounds.map((round) => {
      const result = resultsByTask(round.evalReport).get(task.id);
      if (!result) {
        throw new Error(`Missing retry eval result for task '${task.id}' in round '${round.id}'.`);
      }
      return taskRoundResult(round.id, result);
    });
    const initial = attempts[0] as RetryEvalTaskRoundResult;
    const final = attempts[attempts.length - 1] as RetryEvalTaskRoundResult;
    const firstPassing = attempts.find((attempt) => attempt.passed);
    return {
      taskId: task.id,
      question: task.question,
      status: taskStatus(initial, final),
      ...(firstPassing ? { firstPassingRoundId: firstPassing.roundId } : {}),
      finalRoundId: final.roundId,
      initial,
      final,
      attempts
    };
  });
}

function buildSummary(
  dataset: EvalDataset,
  rounds: RetryEvalRoundReport[],
  transitions: RetryEvalTransitionReport[],
  tasks: RetryEvalTaskReport[]
): RetryEvalSummary {
  const first = rounds[0] as RetryEvalRoundReport;
  const final = rounds[rounds.length - 1] as RetryEvalRoundReport;
  const retryPacketsGenerated = transitions.reduce((sum, transition) => sum + transition.retryPacketsGenerated, 0);
  const retryPacketsResolvedNextRound = transitions.reduce((sum, transition) => sum + transition.retryPacketsResolved, 0);
  const roundsToPass = tasks
    .map((task) => task.attempts.findIndex((attempt) => attempt.passed))
    .filter((index) => index >= 0)
    .map((index) => index + 1);
  const diagnosticsRemaining = countDiagnostics(final.evalReport.results);
  return {
    totalTasks: dataset.tasks.length,
    rounds: rounds.length,
    totalAttempts: rounds.reduce((sum, round) => sum + round.evalReport.metrics.attemptedTasks, 0),
    initialPassedTasks: first.evalReport.metrics.passedTasks,
    finalPassedTasks: final.evalReport.metrics.passedTasks,
    deltaPassedTasks: final.evalReport.metrics.passedTasks - first.evalReport.metrics.passedTasks,
    initialPassRate: first.evalReport.metrics.passRate,
    finalPassRate: final.evalReport.metrics.passRate,
    deltaPassRate: rounded(final.evalReport.metrics.passRate - first.evalReport.metrics.passRate),
    finalExecutableRate: final.evalReport.metrics.executableRate,
    alreadyPassedTasks: tasks.filter((task) => task.status === "already-passed").length,
    convergedTasks: tasks.filter((task) => task.status === "converged").length,
    improvedTasks: tasks.filter((task) => task.status === "improved").length,
    regressedTasks: tasks.filter((task) => task.status === "regressed").length,
    unresolvedTasks: tasks.filter((task) => task.status === "unresolved").length,
    retryPacketsGenerated,
    retryPacketsResolvedNextRound,
    retryPacketResolutionRate: ratio(retryPacketsResolvedNextRound, retryPacketsGenerated),
    averageRoundsToPass: ratio(roundsToPass.reduce((sum, value) => sum + value, 0), roundsToPass.length),
    diagnosticsRemaining,
    models: unique(rounds.flatMap((round) => (round.model ? [round.model] : [])))
  };
}

function taskRoundResult(roundId: string, result: EvalResult): RetryEvalTaskRoundResult {
  return {
    roundId,
    kind: result.kind,
    passed: result.passed,
    canExecute: result.canExecute,
    diagnostics: [...result.diagnostics],
    repairs: [...result.repairs],
    failedExpectations: result.expectationResults.filter((expectation) => !expectation.passed).length,
    qualityScore: qualityScore(result)
  };
}

function taskStatus(initial: RetryEvalTaskRoundResult, final: RetryEvalTaskRoundResult): RetryEvalTaskStatus {
  if (initial.passed && final.passed) {
    return "already-passed";
  }
  if (!initial.passed && final.passed) {
    return "converged";
  }
  if (final.qualityScore > initial.qualityScore) {
    return "improved";
  }
  if (final.qualityScore < initial.qualityScore) {
    return "regressed";
  }
  return "unresolved";
}

function qualityScore(result: EvalResult): number {
  const expectationCount = result.expectationResults.length;
  const passedExpectations = result.expectationResults.filter((expectation) => expectation.passed).length;
  const expectationScore = expectationCount === 0 ? 0 : passedExpectations / expectationCount;
  return rounded(
    (result.passed ? 4 : 0) +
      (result.canExecute ? 2 : 0) +
      expectationScore +
      (result.repairs.length > 0 ? 0.25 : 0) -
      Math.min(1, result.diagnostics.length * 0.1)
  );
}

function resultsByTask(report: EvalReport): Map<string, EvalResult> {
  return new Map(report.results.map((result) => [result.taskId, result]));
}

function countDiagnostics(results: EvalResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const code of result.diagnostics) {
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return sortedCounts(counts);
}

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : rounded(numerator / denominator);
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
