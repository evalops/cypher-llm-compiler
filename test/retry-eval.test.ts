import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { EvalAttemptSet, EvalDataset } from "../src/evals.js";
import { evaluateRetryAttempts } from "../src/retry-eval.js";

describe("CypherBench retry eval", () => {
  it("measures multi-round convergence and retry packet resolution", () => {
    const dataset = readJson<EvalDataset>("examples/eval-dataset.json");
    const raw = readJson<EvalAttemptSet>("examples/benchmarks/tool-hash-raw-baseline.attempts.json");
    const repaired = readJson<EvalAttemptSet>("examples/eval-attempts.json");
    const report = evaluateRetryAttempts(
      dataset,
      [
        { id: "raw", attempts: raw },
        { id: "repaired", attempts: repaired }
      ],
      { defaultLimit: 25, defaultMaxHops: 5 }
    );

    assert.equal(report.version, "cypher-llm-retry-eval/v1");
    assert.equal(report.summary.rounds, 2);
    assert.equal(report.summary.initialPassedTasks, 1);
    assert.equal(report.summary.finalPassedTasks, 3);
    assert.equal(report.summary.deltaPassedTasks, 2);
    assert.equal(report.summary.convergedTasks, 2);
    assert.equal(report.summary.unresolvedTasks, 0);
    assert.equal(report.summary.retryPacketsGenerated, 3);
    assert.equal(report.summary.retryPacketsResolvedNextRound, 3);
    assert.equal(report.summary.retryPacketResolutionRate, 1);
    assert.ok(report.transitions[0]?.diagnosticsAddressed["no-cypher-output"] === 1);
    assert.ok(report.tasks.some((task) => task.taskId === "tool-scope-drift" && task.status === "converged"));
  });

  it("keeps checked-in retry eval JSON aligned with runtime data", () => {
    const dataset = readJson<EvalDataset>("examples/eval-dataset.json");
    const raw = readJson<EvalAttemptSet>("examples/benchmarks/tool-hash-raw-baseline.attempts.json");
    const repaired = readJson<EvalAttemptSet>("examples/eval-attempts.json");
    const expected = readJson("examples/benchmarks/tool-hash.retry-eval.json");
    const actual = evaluateRetryAttempts(
      dataset,
      [
        { id: "tool-hash-raw-baseline.attempts", attempts: raw },
        { id: "eval-attempts", attempts: repaired }
      ],
      { defaultLimit: 25, defaultMaxHops: 5 }
    );

    assert.deepEqual(actual, expected);
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
