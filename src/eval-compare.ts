import type { EvalMetrics, EvalReport } from "./evals.js";

export type MetricDirection = "higher-is-better" | "lower-is-better" | "informational";
export type MetricStatus = "improved" | "regressed" | "unchanged" | "info";

export interface EvalCompareOptions {
  tolerance?: number;
}

export interface EvalMetricDelta {
  metric: keyof Omit<EvalMetrics, "diagnosticsByCode">;
  baseline: number;
  candidate: number;
  delta: number;
  percentChange?: number;
  direction: MetricDirection;
  status: MetricStatus;
}

export interface EvalDiagnosticDelta {
  code: string;
  baseline: number;
  candidate: number;
  delta: number;
  status: MetricStatus;
}

export interface EvalReportComparison {
  version: "cypher-llm-eval-comparison/v1";
  baseline: EvalReportSummary;
  candidate: EvalReportSummary;
  metrics: EvalMetricDelta[];
  diagnostics: EvalDiagnosticDelta[];
  regressions: EvalMetricDelta[];
  improvements: EvalMetricDelta[];
  summary: {
    status: "improved" | "regressed" | "unchanged";
    regressionCount: number;
    improvementCount: number;
  };
}

export interface EvalReportSummary {
  datasetName: string;
  model?: string;
  prompt?: string;
}

const HIGHER_IS_BETTER = new Set<keyof Omit<EvalMetrics, "diagnosticsByCode">>([
  "passedTasks",
  "executablePlans",
  "expectedCypherMatches",
  "expectedDiagnosticMatches",
  "passRate",
  "executableRate"
]);

const LOWER_IS_BETTER = new Set<keyof Omit<EvalMetrics, "diagnosticsByCode">>([
  "missingAttempts",
  "failedTasks",
  "noCypherAttempts",
  "timeoutAttempts",
  "observedSyntaxErrors",
  "observedTimeouts",
  "observedNoCypher"
]);

const METRICS: (keyof Omit<EvalMetrics, "diagnosticsByCode">)[] = [
  "totalTasks",
  "attemptedTasks",
  "missingAttempts",
  "passedTasks",
  "failedTasks",
  "irAttempts",
  "rawAttempts",
  "noCypherAttempts",
  "timeoutAttempts",
  "executablePlans",
  "repairApplied",
  "expectedCypherMatches",
  "expectedDiagnosticMatches",
  "observedSyntaxErrors",
  "observedTimeouts",
  "observedNoCypher",
  "observedReturnsResults",
  "expectedAnswerTasks",
  "passRate",
  "executableRate",
  "repairRate"
];

export function compareEvalReports(
  baseline: EvalReport,
  candidate: EvalReport,
  options: EvalCompareOptions = {}
): EvalReportComparison {
  const tolerance = options.tolerance ?? 0;
  const metrics = METRICS.map((metric) => metricDelta(metric, baseline.metrics[metric], candidate.metrics[metric], tolerance));
  const diagnostics = diagnosticDeltas(baseline, candidate);
  const regressions = metrics.filter((item) => item.status === "regressed");
  const improvements = metrics.filter((item) => item.status === "improved");

  return {
    version: "cypher-llm-eval-comparison/v1",
    baseline: reportSummary(baseline),
    candidate: reportSummary(candidate),
    metrics,
    diagnostics,
    regressions,
    improvements,
    summary: {
      status: regressions.length > 0 ? "regressed" : improvements.length > 0 ? "improved" : "unchanged",
      regressionCount: regressions.length,
      improvementCount: improvements.length
    }
  };
}

function metricDelta(
  metric: keyof Omit<EvalMetrics, "diagnosticsByCode">,
  baseline: number,
  candidate: number,
  tolerance: number
): EvalMetricDelta {
  const delta = round(candidate - baseline);
  const direction = metricDirection(metric);
  return {
    metric,
    baseline,
    candidate,
    delta,
    ...(baseline !== 0 ? { percentChange: round(delta / Math.abs(baseline)) } : {}),
    direction,
    status: metricStatus(delta, direction, tolerance)
  };
}

function diagnosticDeltas(baseline: EvalReport, candidate: EvalReport): EvalDiagnosticDelta[] {
  const codes = new Set([
    ...Object.keys(baseline.metrics.diagnosticsByCode),
    ...Object.keys(candidate.metrics.diagnosticsByCode)
  ]);
  return [...codes].sort((left, right) => left.localeCompare(right)).map((code) => {
    const baselineCount = baseline.metrics.diagnosticsByCode[code] ?? 0;
    const candidateCount = candidate.metrics.diagnosticsByCode[code] ?? 0;
    const delta = candidateCount - baselineCount;
    return {
      code,
      baseline: baselineCount,
      candidate: candidateCount,
      delta,
      status: delta < 0 ? "improved" : delta > 0 ? "regressed" : "unchanged"
    };
  });
}

function metricDirection(metric: keyof Omit<EvalMetrics, "diagnosticsByCode">): MetricDirection {
  if (HIGHER_IS_BETTER.has(metric)) {
    return "higher-is-better";
  }
  if (LOWER_IS_BETTER.has(metric)) {
    return "lower-is-better";
  }
  return "informational";
}

function metricStatus(delta: number, direction: MetricDirection, tolerance: number): MetricStatus {
  if (Math.abs(delta) <= tolerance) {
    return direction === "informational" ? "info" : "unchanged";
  }
  if (direction === "informational") {
    return "info";
  }
  if (direction === "higher-is-better") {
    return delta > 0 ? "improved" : "regressed";
  }
  return delta < 0 ? "improved" : "regressed";
}

function reportSummary(report: EvalReport): EvalReportSummary {
  return {
    datasetName: report.datasetName,
    ...(report.model ? { model: report.model } : {}),
    ...(report.prompt ? { prompt: report.prompt } : {})
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
