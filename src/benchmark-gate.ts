import { compareEvalReports, type EvalReportComparison, type EvalReportSummary } from "./eval-compare.js";
import type { EvalReport } from "./evals.js";

export type BenchmarkGateStatus = "passed" | "failed";

export interface BenchmarkGateOptions {
  tolerance?: number;
  minPassRate?: number;
  minExecutableRate?: number;
  failOnDiagnosticRegression?: boolean;
}

export interface BenchmarkGateCheck {
  id: string;
  status: BenchmarkGateStatus;
  expected: string | number | boolean;
  actual: string | number | boolean;
  message: string;
}

export interface BenchmarkGateReport {
  version: "cypher-llm-benchmark-gate/v1";
  status: BenchmarkGateStatus;
  baseline: EvalReportSummary;
  candidate: EvalReportSummary;
  thresholds: {
    tolerance: number;
    metricRegressionsAllowed: 0;
    failOnDiagnosticRegression: boolean;
    minPassRate?: number;
    minExecutableRate?: number;
  };
  checks: BenchmarkGateCheck[];
  comparison: EvalReportComparison;
  summary: {
    checks: number;
    passed: number;
    failed: number;
    metricRegressions: number;
    diagnosticRegressions: number;
  };
}

export function buildBenchmarkGateReport(
  baseline: EvalReport,
  candidate: EvalReport,
  options: BenchmarkGateOptions = {}
): BenchmarkGateReport {
  const tolerance = options.tolerance ?? 0;
  const comparison = compareEvalReports(baseline, candidate, { tolerance });
  const diagnosticRegressions = comparison.diagnostics.filter((item) => item.status === "regressed");
  const checks: BenchmarkGateCheck[] = [
    {
      id: "no-metric-regressions",
      status: comparison.regressions.length === 0 ? "passed" : "failed",
      expected: 0,
      actual: comparison.regressions.length,
      message: "Directional benchmark metrics must not regress."
    }
  ];

  if (options.minPassRate !== undefined) {
    checks.push({
      id: "min-pass-rate",
      status: candidate.metrics.passRate + tolerance >= options.minPassRate ? "passed" : "failed",
      expected: options.minPassRate,
      actual: candidate.metrics.passRate,
      message: "Candidate pass rate must meet the configured floor."
    });
  }

  if (options.minExecutableRate !== undefined) {
    checks.push({
      id: "min-executable-rate",
      status: candidate.metrics.executableRate + tolerance >= options.minExecutableRate ? "passed" : "failed",
      expected: options.minExecutableRate,
      actual: candidate.metrics.executableRate,
      message: "Candidate executable rate must meet the configured floor."
    });
  }

  if (options.failOnDiagnosticRegression === true) {
    checks.push({
      id: "no-diagnostic-regressions",
      status: diagnosticRegressions.length === 0 ? "passed" : "failed",
      expected: 0,
      actual: diagnosticRegressions.length,
      message: "Diagnostic-code counts must not increase when diagnostic regression gating is enabled."
    });
  }

  const failed = checks.filter((check) => check.status === "failed").length;
  return {
    version: "cypher-llm-benchmark-gate/v1",
    status: failed === 0 ? "passed" : "failed",
    baseline: comparison.baseline,
    candidate: comparison.candidate,
    thresholds: {
      tolerance,
      metricRegressionsAllowed: 0,
      failOnDiagnosticRegression: options.failOnDiagnosticRegression ?? false,
      ...(options.minPassRate !== undefined ? { minPassRate: options.minPassRate } : {}),
      ...(options.minExecutableRate !== undefined ? { minExecutableRate: options.minExecutableRate } : {})
    },
    checks,
    comparison,
    summary: {
      checks: checks.length,
      passed: checks.length - failed,
      failed,
      metricRegressions: comparison.regressions.length,
      diagnosticRegressions: diagnosticRegressions.length
    }
  };
}
