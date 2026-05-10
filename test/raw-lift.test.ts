import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { EvalAttemptSet, EvalDataset } from "../src/evals.js";
import type { CypherSchemaContract } from "../src/ir.js";
import { evaluateRawLiftAttempts, liftRawCypherToIr } from "../src/raw-lift.js";
import { validateRenderedQueryWithParser } from "../src/parser-validation.js";

const schema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  dialect: "neo4j-cypher-25",
  nodes: [
    { name: "Tool", properties: { name: { type: "STRING" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [{ type: "has MD5 hash", from: "Tool", to: "Hash" }]
};

describe("raw Cypher lifting", () => {
  it("lifts common MATCH/RETURN read queries into structured IR", () => {
    const lifted = liftRawCypherToIr(
      "MATCH (tool:Tool {name: $toolName})-[:has MD5 hash]->(hash:Hash) RETURN hash.value AS md5 LIMIT 10",
      schema
    );

    assert.equal(lifted.rawClauses, 0);
    assert.equal(lifted.supportedClauses, 2);
    assert.deepEqual(lifted.query.clauses.map((clause) => clause.kind), ["match", "return"]);
    assert.equal(
      lifted.renderedCypher,
      "MATCH (tool:`Tool` {`name`: $toolName})-[:`has MD5 hash`]->(hash:`Hash`)\nRETURN hash.`value` AS md5\nLIMIT 10"
    );
    assert.equal(validateRenderedQueryWithParser(lifted.query, schema, { mode: "syntax" }).ok, true);
  });

  it("preserves unsupported clauses as explicit raw escape hatches", () => {
    const lifted = liftRawCypherToIr("MATCH (a) USING INDEX a:Person(name) RETURN a", schema);

    assert.equal(lifted.rawClauses, 1);
    assert.equal(lifted.query.clauses[0]?.kind, "raw");
    assert.ok(lifted.diagnostics.some((diagnostic) => diagnostic.code === "raw-lift-unsupported-clause"));
  });

  it("evaluates raw lifting over imported text2cypher attempts", () => {
    const dataset = readJson<EvalDataset>("examples/imported/text2cypher-gpt4o-sample.dataset.json");
    const attempts = readJson<EvalAttemptSet>("examples/imported/text2cypher-gpt4o-sample.attempts.json");
    const report = evaluateRawLiftAttempts(dataset, attempts);

    assert.equal(report.version, "cypher-llm-raw-lift-eval/v1");
    assert.equal(report.rawAttempts >= 1, true);
    assert.equal(report.fullyLifted + report.partiallyLifted + report.unsupported, report.rawAttempts);
    assert.deepEqual(report.diagnosticsByCode, {});
    assert.ok(report.results[0]?.renderedCypher.includes("COUNT(*) AS interactionCount"));
    assert.ok(report.results[1]?.renderedCypher.includes("WHERE (r.`key` = 'specific_key')"));
    assert.ok(report.results[1]?.renderedCypher.includes("ORDER BY interactions DESC"));
  });
});

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
