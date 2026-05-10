import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildBenchmarkGateReport } from "../src/benchmark-gate.js";
import type { EvalReport } from "../src/evals.js";

describe("CypherBench benchmark gates", () => {
  it("passes when candidate improves metrics and meets floors", () => {
    const baseline = readJson<EvalReport>("examples/benchmarks/tool-hash-raw-baseline.report.json");
    const candidate = readJson<EvalReport>("examples/imported/smoke-ir-vs-raw.report.json");
    const gate = buildBenchmarkGateReport(baseline, candidate, { minPassRate: 1, minExecutableRate: 0.3333 });

    assert.equal(gate.version, "cypher-llm-benchmark-gate/v1");
    assert.equal(gate.status, "passed");
    assert.equal(gate.summary.metricRegressions, 0);
    assert.equal(gate.checks.every((check) => check.status === "passed"), true);
  });

  it("fails on metric regressions and configured floors", () => {
    const baseline = readJson<EvalReport>("examples/imported/smoke-ir-vs-raw.report.json");
    const candidate = readJson<EvalReport>("examples/benchmarks/tool-hash-raw-baseline.report.json");
    const gate = buildBenchmarkGateReport(baseline, candidate, { minPassRate: 0.9 });

    assert.equal(gate.status, "failed");
    assert.ok(gate.summary.metricRegressions > 0);
    assert.ok(gate.checks.some((check) => check.id === "min-pass-rate" && check.status === "failed"));
  });

  it("can fail on diagnostic regressions when configured", () => {
    const baseline = readJson<EvalReport>("examples/benchmarks/tool-hash-raw-baseline.report.json");
    const candidate = readJson<EvalReport>("examples/imported/smoke-ir-vs-raw.report.json");
    const gate = buildBenchmarkGateReport(baseline, candidate, { failOnDiagnosticRegression: true });

    assert.equal(gate.status, "failed");
    assert.ok(gate.checks.some((check) => check.id === "no-diagnostic-regressions" && check.status === "failed"));
  });

  it("keeps checked-in benchmark gate JSON aligned with runtime data", () => {
    const baseline = readJson<EvalReport>("examples/benchmarks/tool-hash-raw-baseline.report.json");
    const candidate = readJson<EvalReport>("examples/imported/smoke-ir-vs-raw.report.json");
    const expected = readJson("examples/benchmarks/tool-hash.benchmark-gate.json");
    const regenerated = buildBenchmarkGateReport(baseline, candidate, { minPassRate: 1, minExecutableRate: 0.3333 });

    assert.deepEqual(regenerated, expected);
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
