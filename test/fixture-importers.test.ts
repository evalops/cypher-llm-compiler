import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAttempts } from "../src/evals.js";
import {
  importFunctionalCypherJson,
  importOpenCypherTckFeature,
  importText2CypherCsv,
  inferSchemaFromCypher
} from "../src/fixture-importers.js";

describe("fixture importers", () => {
  it("imports text2cypher CSV rows with upstream outcome labels", () => {
    const csv = [
      "question,cypher,type,database,explanation,syntax_error,timeout,returns_results,no_cypher",
      '"Find users","MATCH (u:User)-[:FOLLOWS]->(v:User) RETURN v",Simple,graph,"",False,False,True,False',
      '"No query","I cannot answer",Complex,graph,"",True,False,False,True',
      '"Timeout","MATCH (n) RETURN n",Complex,graph,"",False,True,False,False'
    ].join("\n");

    const imported = importText2CypherCsv(csv, {
      datasetName: "csv-smoke",
      source: "neo4j-labs/text2cypher:test",
      model: "fixture-model"
    });
    const report = evaluateAttempts(imported.dataset, imported.attempts);

    assert.equal(imported.summary.importedRows, 3);
    assert.equal(imported.summary.noCypherRows, 1);
    assert.equal(imported.summary.timeoutRows, 1);
    assert.equal(imported.summary.returnsResultsRows, 1);
    assert.equal(report.metrics.rawAttempts, 1);
    assert.equal(report.metrics.noCypherAttempts, 1);
    assert.equal(report.metrics.timeoutAttempts, 1);
    assert.equal(report.metrics.observedNoCypher, 1);
    assert.equal(imported.dataset.tasks[0]?.schema.nodes.some((node) => node.name === "User"), true);
  });

  it("imports functional Cypher JSON as expected-answer fixtures", () => {
    const imported = importFunctionalCypherJson(
      JSON.stringify([
        {
          Prompt: "Convert question",
          Question: "Count articles",
          Schema: "Graph schema: Article",
          Cypher: "MATCH (n:Article) RETURN count(n)"
        }
      ]),
      {
        datasetName: "functional-smoke",
        source: "neo4j-labs/text2cypher:functional"
      }
    );

    assert.equal(imported.summary.expectedAnswerRows, 1);
    assert.equal(imported.dataset.tasks[0]?.expected?.referenceCypher, "MATCH (n:Article) RETURN count(n)");
    assert.equal(imported.attempts.attempts[0]?.observed?.hasExpectedAnswer, true);
  });

  it("imports openCypher TCK feature queries as syntax fixtures", () => {
    const feature = `
Feature: Aggregation1 - Count

  Scenario: [1] Count only non-null values
    Given an empty graph
    When executing query:
      """
      MATCH (n)
      RETURN count(n)
      """
    Then the result should be, in any order:
      | count(n) |
      | 0        |
`;
    const imported = importOpenCypherTckFeature(feature, {
      datasetName: "tck-smoke",
      source: "opencypher/openCypher:tck"
    });

    assert.equal(imported.summary.importedRows, 1);
    assert.equal(imported.summary.expectedAnswerRows, 1);
    assert.match(imported.dataset.tasks[0]?.question ?? "", /Count only non-null values/);
    assert.equal(imported.attempts.attempts[0]?.rawCypher, "MATCH (n)\n      RETURN count(n)");
  });

  it("infers minimal schema contracts from Cypher text", () => {
    const schema = inferSchemaFromCypher("MATCH (a:Person)-[:ACTED_IN]->(m:Movie) RETURN m.title");

    assert.deepEqual(
      schema.nodes.map((node) => node.name),
      ["Movie", "Person"]
    );
    assert.deepEqual(schema.relationships, [{ type: "ACTED_IN", from: "Person", to: "Movie" }]);
  });
});
