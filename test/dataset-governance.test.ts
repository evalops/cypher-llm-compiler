import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildDatasetGovernanceReport } from "../src/dataset-governance.js";
import type { EvalDataset } from "../src/evals.js";

describe("dataset governance", () => {
  it("audits provenance, split tags, and redaction policy", () => {
    const dataset = readJson<EvalDataset>("examples/eval-dataset.json");
    const report = buildDatasetGovernanceReport(dataset);

    assert.equal(report.version, "cypher-llm-dataset-governance/v1");
    assert.equal(report.ok, true);
    assert.deepEqual(report.splits, [{ name: "smoke", tasks: 3 }]);
    assert.deepEqual(report.provenance, [{ source: "repo smoke fixture", license: "repo-local", tasks: 3 }]);
    assert.equal(report.redaction.status, "pass");
    assert.deepEqual(report.summary.diagnosticsByCode, {});
  });

  it("reports missing source, missing split, duplicate ids, and sensitive-looking values", () => {
    const dataset: EvalDataset = {
      version: "cypher-llm-eval-dataset/v1",
      name: "bad-dataset",
      tasks: [
        {
          id: "one",
          question: "Email alice@example.com",
          schema: { version: "cypher-llm-schema/v1", nodes: [], relationships: [] }
        },
        {
          id: "one",
          question: "Key",
          tags: ["split:test"],
          source: "unknown",
          params: { token: "sk-1234567890abcdef" },
          schema: { version: "cypher-llm-schema/v1", nodes: [], relationships: [] }
        }
      ]
    };
    const report = buildDatasetGovernanceReport(dataset);

    assert.equal(report.ok, false);
    assert.equal(report.summary.missingSourceTasks, 1);
    assert.equal(report.summary.missingSplitTasks, 1);
    assert.equal(report.redaction.status, "fail");
    assert.ok(report.diagnostics.some((item) => item.code === "dataset-duplicate-task-id"));
    assert.ok(report.diagnostics.some((item) => item.code === "dataset-redaction-possible-email"));
    assert.ok(report.diagnostics.some((item) => item.code === "dataset-redaction-possible-secret"));
  });

  it("keeps checked-in governance JSON aligned with runtime data", () => {
    const dataset = readJson<EvalDataset>("examples/eval-dataset.json");
    const expected = readJson("examples/benchmarks/tool-hash.dataset-governance.json");
    const regenerated = buildDatasetGovernanceReport(dataset);

    assert.deepEqual(regenerated, expected);
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
