import { diagnostic, type Diagnostic } from "./diagnostics.js";
import type { EvalDataset, EvalTask } from "./evals.js";

export interface DatasetGovernanceOptions {
  generatedAt?: string;
  defaultSplit?: string;
}

export interface DatasetGovernanceReport {
  version: "cypher-llm-dataset-governance/v1";
  datasetName: string;
  generatedAt: string;
  ok: boolean;
  summary: DatasetGovernanceSummary;
  splits: DatasetSplitSummary[];
  provenance: DatasetProvenanceSummary[];
  redaction: DatasetRedactionSummary;
  tasks: DatasetTaskGovernance[];
  diagnostics: Diagnostic[];
}

export interface DatasetGovernanceSummary {
  tasks: number;
  sources: number;
  splits: number;
  missingSourceTasks: number;
  missingSplitTasks: number;
  redactionFindings: number;
  diagnosticsByCode: Record<string, number>;
}

export interface DatasetSplitSummary {
  name: string;
  tasks: number;
}

export interface DatasetProvenanceSummary {
  source: string;
  license: string;
  tasks: number;
}

export interface DatasetRedactionSummary {
  policy: "default-public-benchmark";
  status: "pass" | "fail";
  findings: DatasetRedactionFinding[];
}

export interface DatasetRedactionFinding {
  taskId: string;
  field: string;
  code: "possible-email" | "possible-secret" | "private-key";
  severity: "error";
}

export interface DatasetTaskGovernance {
  id: string;
  source?: string;
  split: string;
  tags: string[];
  provenanceLicense: string;
  redactionFindings: DatasetRedactionFinding[];
}

const SPLIT_PREFIX = "split:";
const DEFAULT_SPLIT = "unspecified";

export function buildDatasetGovernanceReport(
  dataset: EvalDataset,
  options: DatasetGovernanceOptions = {}
): DatasetGovernanceReport {
  const diagnostics: Diagnostic[] = [];
  const seenIds = new Set<string>();
  const tasks = dataset.tasks.map((task) => {
    const taskDiagnostics: Diagnostic[] = [];
    if (seenIds.has(task.id)) {
      taskDiagnostics.push(
        diagnostic({
          code: "dataset-duplicate-task-id",
          severity: "error",
          message: `Task id '${task.id}' appears more than once.`,
          path: `/tasks/${task.id}`,
          suggestion: "Make every benchmark task id stable and unique."
        })
      );
    }
    seenIds.add(task.id);

    if (!task.source) {
      taskDiagnostics.push(
        diagnostic({
          code: "dataset-missing-source",
          severity: "warning",
          message: `Task '${task.id}' does not declare provenance source.`,
          path: `/tasks/${task.id}/source`,
          suggestion: "Add a source string that points to the fixture, upstream row, or generation recipe."
        })
      );
    }

    const split = splitForTask(task, options.defaultSplit);
    if (split === DEFAULT_SPLIT) {
      taskDiagnostics.push(
        diagnostic({
          code: "dataset-missing-split",
          severity: "warning",
          message: `Task '${task.id}' does not declare a split tag.`,
          path: `/tasks/${task.id}/tags`,
          suggestion: "Add a tag such as split:train, split:validation, split:test, split:holdout, or split:smoke."
        })
      );
    }

    const redactionFindings = redactionFindingsForTask(task);
    for (const finding of redactionFindings) {
      taskDiagnostics.push(
        diagnostic({
          code: `dataset-redaction-${finding.code}`,
          severity: "error",
          message: `Task '${task.id}' contains ${finding.code} in ${finding.field}.`,
          path: `/tasks/${task.id}/${finding.field}`,
          suggestion: "Redact or replace sensitive-looking content before publishing the dataset."
        })
      );
    }

    diagnostics.push(...taskDiagnostics);
    return {
      id: task.id,
      ...(task.source ? { source: task.source } : {}),
      split,
      tags: task.tags ?? [],
      provenanceLicense: licenseForSource(task.source),
      redactionFindings
    };
  });

  const redactionFindings = tasks.flatMap((task) => task.redactionFindings);
  return {
    version: "cypher-llm-dataset-governance/v1",
    datasetName: dataset.name,
    generatedAt: options.generatedAt ?? "2026-05-10",
    ok: !diagnostics.some((item) => item.severity === "error"),
    summary: {
      tasks: tasks.length,
      sources: provenanceSummary(tasks).length,
      splits: splitSummary(tasks).length,
      missingSourceTasks: tasks.filter((task) => !task.source).length,
      missingSplitTasks: tasks.filter((task) => task.split === DEFAULT_SPLIT).length,
      redactionFindings: redactionFindings.length,
      diagnosticsByCode: countDiagnostics(diagnostics)
    },
    splits: splitSummary(tasks),
    provenance: provenanceSummary(tasks),
    redaction: {
      policy: "default-public-benchmark",
      status: redactionFindings.length === 0 ? "pass" : "fail",
      findings: redactionFindings
    },
    tasks,
    diagnostics
  };
}

function splitForTask(task: EvalTask, defaultSplit: string | undefined): string {
  const splitTag = (task.tags ?? []).find((tag) => tag.startsWith(SPLIT_PREFIX));
  if (splitTag) {
    return splitTag.slice(SPLIT_PREFIX.length);
  }
  return defaultSplit ?? DEFAULT_SPLIT;
}

function provenanceSummary(tasks: DatasetTaskGovernance[]): DatasetProvenanceSummary[] {
  const bySource = new Map<string, DatasetProvenanceSummary>();
  for (const task of tasks) {
    const source = task.source ?? "missing-source";
    const current = bySource.get(source) ?? { source, license: task.provenanceLicense, tasks: 0 };
    current.tasks += 1;
    bySource.set(source, current);
  }
  return [...bySource.values()].sort((left, right) => left.source.localeCompare(right.source));
}

function splitSummary(tasks: DatasetTaskGovernance[]): DatasetSplitSummary[] {
  const bySplit = new Map<string, number>();
  for (const task of tasks) {
    bySplit.set(task.split, (bySplit.get(task.split) ?? 0) + 1);
  }
  return [...bySplit.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => ({ name, tasks: count }));
}

function redactionFindingsForTask(task: EvalTask): DatasetRedactionFinding[] {
  return [
    ...redactionFindingsForField(task.id, "question", task.question),
    ...redactionFindingsForField(task.id, "source", task.source ?? ""),
    ...redactionFindingsForField(task.id, "params", task.params ?? {}),
    ...redactionFindingsForField(task.id, "expected", task.expected ?? {})
  ];
}

function redactionFindingsForField(taskId: string, field: string, value: unknown): DatasetRedactionFinding[] {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const findings: DatasetRedactionFinding[] = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
    findings.push({ taskId, field, code: "possible-email", severity: "error" });
  }
  if (/(?:sk-[A-Za-z0-9_-]{16,}|api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_-]{16,})/i.test(text)) {
    findings.push({ taskId, field, code: "possible-secret", severity: "error" });
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    findings.push({ taskId, field, code: "private-key", severity: "error" });
  }
  return findings;
}

function licenseForSource(source: string | undefined): string {
  if (!source) {
    return "unknown";
  }
  if (source.startsWith("repo smoke fixture")) {
    return "repo-local";
  }
  if (source.startsWith("neo4j-labs/text2cypher")) {
    return "CC0-1.0";
  }
  if (source.startsWith("opencypher/openCypher")) {
    return "Apache-2.0";
  }
  return "unknown";
}

function countDiagnostics(diagnostics: Diagnostic[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of diagnostics) {
    counts[item.code] = (counts[item.code] ?? 0) + 1;
  }
  return counts;
}
