import { compareEvalReports, type EvalReportComparison } from "./eval-compare.js";
import type { EvalMetrics, EvalReport } from "./evals.js";

export type ScorecardLaneKind = "ir-first" | "raw" | "mixed" | "terminal" | "unknown";

export interface CypherBenchScorecardOptions {
  name?: string;
  generatedAt?: string;
  baselineIndex?: number;
}

export interface CypherBenchScorecard {
  version: "cypher-llm-cypherbench-scorecard/v1";
  name: string;
  generatedAt: string;
  baselineLaneId: string;
  summary: CypherBenchScorecardSummary;
  lanes: CypherBenchLane[];
  comparisons: EvalReportComparison[];
  diagnostics: CypherBenchDiagnosticSummary[];
  rankings: CypherBenchRankings;
}

export interface CypherBenchScorecardSummary {
  reports: number;
  datasets: string[];
  totalTasks: number;
  bestPassRate: number;
  bestExecutableRate: number;
  regressionCount: number;
  improvementCount: number;
  status: "improved" | "regressed" | "unchanged";
}

export interface CypherBenchLane {
  id: string;
  datasetName: string;
  model?: string;
  prompt?: string;
  kind: ScorecardLaneKind;
  metrics: EvalMetrics;
}

export interface CypherBenchDiagnosticSummary {
  code: string;
  total: number;
  lanes: Record<string, number>;
}

export interface CypherBenchRankings {
  passRate: string[];
  executableRate: string[];
  repairRate: string[];
}

export function buildCypherBenchScorecard(
  reports: EvalReport[],
  options: CypherBenchScorecardOptions = {}
): CypherBenchScorecard {
  if (reports.length === 0) {
    throw new Error("CypherBench scorecard requires at least one eval report.");
  }
  const lanes = reports.map((report, index) => laneForReport(report, index));
  const baselineIndex = options.baselineIndex ?? 0;
  const baseline = reports[baselineIndex];
  const baselineLane = lanes[baselineIndex];
  if (!baseline || !baselineLane) {
    throw new Error(`Invalid baseline index ${baselineIndex}.`);
  }
  const comparisons = reports
    .map((report, index) => ({ report, index }))
    .filter((item) => item.index !== baselineIndex)
    .map((item) => compareEvalReports(baseline, item.report));
  const regressionCount = comparisons.reduce((sum, comparison) => sum + comparison.summary.regressionCount, 0);
  const improvementCount = comparisons.reduce((sum, comparison) => sum + comparison.summary.improvementCount, 0);

  return {
    version: "cypher-llm-cypherbench-scorecard/v1",
    name: options.name ?? "cypherbench-scorecard",
    generatedAt: options.generatedAt ?? "2026-05-10",
    baselineLaneId: baselineLane.id,
    summary: {
      reports: reports.length,
      datasets: [...new Set(reports.map((report) => report.datasetName))].sort((left, right) => left.localeCompare(right)),
      totalTasks: reports.reduce((sum, report) => sum + report.metrics.totalTasks, 0),
      bestPassRate: maxMetric(lanes, "passRate"),
      bestExecutableRate: maxMetric(lanes, "executableRate"),
      regressionCount,
      improvementCount,
      status: regressionCount > 0 ? "regressed" : improvementCount > 0 ? "improved" : "unchanged"
    },
    lanes,
    comparisons,
    diagnostics: diagnosticSummary(lanes),
    rankings: {
      passRate: rankLanes(lanes, "passRate"),
      executableRate: rankLanes(lanes, "executableRate"),
      repairRate: rankLanes(lanes, "repairRate")
    }
  };
}

export function renderCypherBenchScorecardMarkdown(scorecard: CypherBenchScorecard): string {
  const lines = [
    `# ${scorecard.name}`,
    "",
    `Generated: ${scorecard.generatedAt}`,
    `Baseline: ${scorecard.baselineLaneId}`,
    `Status: ${scorecard.summary.status}`,
    "",
    "## Lanes",
    "",
    "| Lane | Dataset | Kind | Pass Rate | Executable Rate | Repair Rate | Failed | Diagnostics |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |"
  ];

  for (const lane of scorecard.lanes) {
    lines.push(
      [
        escapeCell(lane.id),
        escapeCell(lane.datasetName),
        lane.kind,
        formatRate(lane.metrics.passRate),
        formatRate(lane.metrics.executableRate),
        formatRate(lane.metrics.repairRate),
        String(lane.metrics.failedTasks),
        String(Object.values(lane.metrics.diagnosticsByCode).reduce((sum, count) => sum + count, 0))
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |")
    );
  }

  lines.push("", "## Top Diagnostics", "");
  if (scorecard.diagnostics.length === 0) {
    lines.push("No diagnostics recorded.", "");
  } else {
    for (const item of scorecard.diagnostics.slice(0, 10)) {
      lines.push(`- ${item.code}: ${item.total}`);
    }
    lines.push("");
  }

  lines.push("## Rankings", "");
  lines.push(`- Pass rate: ${scorecard.rankings.passRate.join(", ")}`);
  lines.push(`- Executable rate: ${scorecard.rankings.executableRate.join(", ")}`);
  lines.push(`- Repair rate: ${scorecard.rankings.repairRate.join(", ")}`);

  return `${lines.join("\n")}\n`;
}

function laneForReport(report: EvalReport, index: number): CypherBenchLane {
  return {
    id: laneId(report, index),
    datasetName: report.datasetName,
    ...(report.model ? { model: report.model } : {}),
    ...(report.prompt ? { prompt: report.prompt } : {}),
    kind: laneKind(report.metrics),
    metrics: report.metrics
  };
}

function laneId(report: EvalReport, index: number): string {
  const basis = report.model ?? report.prompt ?? report.datasetName;
  const slug = basis.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${index + 1}-${slug || "lane"}`;
}

function laneKind(metrics: EvalMetrics): ScorecardLaneKind {
  if (metrics.irAttempts > 0 && metrics.rawAttempts === 0 && metrics.noCypherAttempts === 0 && metrics.timeoutAttempts === 0) {
    return "ir-first";
  }
  if (metrics.rawAttempts > 0 && metrics.irAttempts === 0) {
    return "raw";
  }
  if (metrics.noCypherAttempts > 0 || metrics.timeoutAttempts > 0) {
    return "terminal";
  }
  if (metrics.irAttempts > 0 && metrics.rawAttempts > 0) {
    return "mixed";
  }
  return "unknown";
}

function diagnosticSummary(lanes: CypherBenchLane[]): CypherBenchDiagnosticSummary[] {
  const byCode = new Map<string, CypherBenchDiagnosticSummary>();
  for (const lane of lanes) {
    for (const [code, count] of Object.entries(lane.metrics.diagnosticsByCode)) {
      const current = byCode.get(code) ?? { code, total: 0, lanes: {} };
      current.total += count;
      current.lanes[lane.id] = count;
      byCode.set(code, current);
    }
  }
  return [...byCode.values()].sort((left, right) => right.total - left.total || left.code.localeCompare(right.code));
}

function rankLanes(lanes: CypherBenchLane[], metric: "passRate" | "executableRate" | "repairRate"): string[] {
  return [...lanes]
    .sort((left, right) => right.metrics[metric] - left.metrics[metric] || left.id.localeCompare(right.id))
    .map((lane) => lane.id);
}

function maxMetric(lanes: CypherBenchLane[], metric: "passRate" | "executableRate"): number {
  return Number(Math.max(...lanes.map((lane) => lane.metrics[metric])).toFixed(4));
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}
