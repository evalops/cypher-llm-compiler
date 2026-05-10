import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { EvalReport } from "../src/evals.js";
import { buildCypherBenchScorecard, renderCypherBenchScorecardMarkdown } from "../src/scorecard.js";

describe("CypherBench scorecards", () => {
  it("summarizes eval reports into ranked benchmark lanes", () => {
    const baseline = readJson<EvalReport>("examples/benchmarks/tool-hash-raw-baseline.report.json");
    const candidate = readJson<EvalReport>("examples/imported/smoke-ir-vs-raw.report.json");
    const scorecard = buildCypherBenchScorecard([baseline, candidate], { name: "tool-hash-scorecard" });

    assert.equal(scorecard.version, "cypher-llm-cypherbench-scorecard/v1");
    assert.equal(scorecard.summary.reports, 2);
    assert.equal(scorecard.lanes.length, 2);
    assert.equal(scorecard.summary.status, "improved");
    assert.deepEqual(scorecard.rankings.passRate, ["2-fixture-model", "1-raw-text2cypher-baseline"]);
    assert.ok(scorecard.diagnostics.some((item) => item.code === "no-cypher-output"));
  });

  it("renders a compact markdown scorecard", () => {
    const baseline = readJson<EvalReport>("examples/benchmarks/tool-hash-raw-baseline.report.json");
    const candidate = readJson<EvalReport>("examples/imported/smoke-ir-vs-raw.report.json");
    const scorecard = buildCypherBenchScorecard([baseline, candidate], { name: "tool-hash-scorecard" });
    const markdown = renderCypherBenchScorecardMarkdown(scorecard);

    assert.ok(markdown.includes("# tool-hash-scorecard"));
    assert.ok(markdown.includes("| Lane | Dataset | Kind | Pass Rate |"));
    assert.ok(markdown.includes("2-fixture-model"));
  });

  it("keeps checked-in scorecard JSON aligned with runtime data", () => {
    const baseline = readJson<EvalReport>("examples/benchmarks/tool-hash-raw-baseline.report.json");
    const candidate = readJson<EvalReport>("examples/imported/smoke-ir-vs-raw.report.json");
    const expected = readJson("examples/benchmarks/tool-hash.scorecard.json");
    const regenerated = buildCypherBenchScorecard([baseline, candidate], { name: "tool-hash-scorecard" });

    assert.deepEqual(regenerated, expected);
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
