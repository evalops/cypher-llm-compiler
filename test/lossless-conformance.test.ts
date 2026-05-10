import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildLosslessConformanceReport,
  defaultLosslessConformanceCases
} from "../src/lossless-conformance.js";

describe("lossless conformance", () => {
  it("covers representative Neo4j, openCypher, GQL, and text2cypher cases", () => {
    const report = buildLosslessConformanceReport();
    const gql = report.cases.find((testCase) => testCase.id === "gql-let-filter-preview");

    assert.equal(report.version, "cypher-llm-lossless-conformance/v1");
    assert.equal(report.summary.totalCases, defaultLosslessConformanceCases.length);
    assert.equal(report.summary.failed, 0);
    assert.equal(report.summary.roundTripPassed, report.summary.totalCases);
    assert.equal(report.summary.bySource["neo4j-example"].cases, 1);
    assert.equal(report.summary.bySource["opencypher-tck"].cases, 1);
    assert.equal(report.summary.bySource["gql-oriented"].cases, 1);
    assert.equal(report.summary.bySource.text2cypher.cases, 1);
    assert.ok(gql?.clauses.some((clause) => clause.keyword === "LET"));
    assert.ok(gql?.clauses.some((clause) => clause.keyword === "FILTER"));
    assert.deepEqual(
      gql?.clauses.map((clause) => [clause.keyword, clause.support]),
      [
        ["MATCH", "raw"],
        ["LET", "raw"],
        ["FILTER", "raw"],
        ["RETURN", "lifted"]
      ]
    );
  });

  it("keeps checked-in conformance JSON aligned with runtime data", () => {
    const expected = readJson("examples/lossless/conformance.json");

    assert.deepEqual(buildLosslessConformanceReport(), expected);
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
