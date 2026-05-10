import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { compareEvalReports } from "../src/eval-compare.js";
import type { EvalAttemptSet, EvalDataset } from "../src/evals.js";
import { evaluateAttempts } from "../src/evals.js";
import { evaluateRepairLoop, repairFeedbackPackets } from "../src/repair-loop.js";

describe("CypherBench comparison", () => {
  it("compares baseline and candidate reports with directional deltas", () => {
    const dataset = readJson<EvalDataset>("examples/eval-dataset.json");
    const baselineAttempts = readJson<EvalAttemptSet>("examples/eval-attempts.json");
    const candidateAttempts: EvalAttemptSet = {
      ...baselineAttempts,
      attempts: baselineAttempts.attempts.map((attempt) =>
        attempt.taskId === "tool-md5-by-name" ? { taskId: attempt.taskId, noCypher: true } : attempt
      )
    };
    const baseline = evaluateAttempts(dataset, baselineAttempts, { defaultLimit: 25, defaultMaxHops: 5 });
    const candidate = evaluateAttempts(dataset, candidateAttempts, { defaultLimit: 25, defaultMaxHops: 5 });
    const comparison = compareEvalReports(baseline, candidate);
    const passRate = comparison.metrics.find((metric) => metric.metric === "passRate");

    assert.equal(comparison.version, "cypher-llm-eval-comparison/v1");
    assert.equal(comparison.summary.status, "regressed");
    assert.equal(passRate?.status, "regressed");
    assert.ok(comparison.diagnostics.some((diagnostic) => diagnostic.code === "no-cypher-output" && diagnostic.delta === 1));
  });
});

describe("repair-loop feedback", () => {
  it("builds targeted repair packets from eval diagnostics", () => {
    const dataset = readJson<EvalDataset>("examples/eval-dataset.json");
    const attempts = readJson<EvalAttemptSet>("examples/eval-attempts.json");
    const evalReport = evaluateAttempts(dataset, attempts, { defaultLimit: 25, defaultMaxHops: 5 });
    const packets = repairFeedbackPackets(dataset, evalReport);
    const packet = packets.find((item) => item.taskId === "tool-scope-drift");

    assert.ok(packet);
    assert.equal(packet?.version, "cypher-llm-repair-packet/v1");
    assert.equal(packet?.diagnostics[0]?.code, "undefined-variable");
    assert.match(packet?.instruction ?? "", /corrected CypherQuery IR/);
  });

  it("evaluates attempts and emits a repair-loop report", () => {
    const dataset = readJson<EvalDataset>("examples/eval-dataset.json");
    const attempts = readJson<EvalAttemptSet>("examples/eval-attempts.json");
    const report = evaluateRepairLoop(dataset, attempts, { defaultLimit: 25, defaultMaxHops: 5 });

    assert.equal(report.version, "cypher-llm-repair-loop/v1");
    assert.equal(report.evalReport.metrics.totalTasks, 3);
    assert.equal(report.metrics.packets >= 2, true);
    assert.equal(report.metrics.diagnosticFailures["undefined-variable"], 1);
  });
});

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
