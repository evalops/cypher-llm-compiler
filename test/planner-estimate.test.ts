import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildPlannerEstimateFromNeo4jSummary, flattenPlannerOperators } from "../src/planner-estimate.js";

describe("planner estimates", () => {
  it("extracts stable cardinality evidence from Neo4j-like summaries", () => {
    const estimate = buildPlannerEstimateFromNeo4jSummary({
      plan: {
        operatorType: "ProduceResults",
        arguments: { EstimatedRows: "42" },
        children: [
          {
            operatorType: "NodeByLabelScan",
            identifiers: ["tool"],
            arguments: { EstimatedRows: 42, DbHits: 120 }
          }
        ]
      }
    });

    assert.equal(estimate.version, "cypher-llm-planner-estimate/v1");
    assert.equal(estimate.source, "neo4j-explain");
    assert.equal(estimate.estimatedRows, 42);
    assert.equal(estimate.dbHits, 120);
    assert.deepEqual(
      flattenPlannerOperators(estimate.operators).map((operator) => operator.name),
      ["ProduceResults", "NodeByLabelScan"]
    );
  });

  it("keeps checked-in planner estimate fixtures aligned with the public shape", () => {
    const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "examples/policy/tool-hash.planner-estimate.json"), "utf8")) as {
      version: string;
      operators: unknown[];
    };

    assert.equal(fixture.version, "cypher-llm-planner-estimate/v1");
    assert.equal(fixture.operators.length, 1);
  });
});
