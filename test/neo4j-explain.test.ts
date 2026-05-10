import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "../src/ir.js";
import { explainWithNeo4j, neo4jErrorDiagnostic, type Neo4jSessionLike } from "../src/neo4j-explain.js";

const schema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  nodes: [{ name: "Tool", properties: { name: { type: "STRING" } } }],
  relationships: [],
  parameters: { toolName: { type: "STRING", required: true } }
};

const query: CypherQuery = {
  version: "cypher-llm-ir/v1",
  profile: "llm-safe-readonly",
  clauses: [
    {
      kind: "match",
      patterns: [
        {
          segments: [
            {
              variable: "tool",
              labels: ["Tool"],
              properties: { name: { kind: "param", name: "toolName" } }
            }
          ]
        }
      ]
    },
    {
      kind: "return",
      items: [{ expression: { kind: "var", name: "tool" } }]
    }
  ]
};

describe("Neo4j EXPLAIN adapter", () => {
  it("runs EXPLAIN through executeRead when the safe plan is executable", async () => {
    const calls: { cypher: string; params?: Record<string, JsonLiteral> }[] = [];
    const session: Neo4jSessionLike = {
      async run() {
        throw new Error("executeRead should be preferred");
      },
      async executeRead(work) {
        return work({
          async run(cypher, params) {
            calls.push(params ? { cypher, params } : { cypher });
            return { summary: { counters: "none" }, records: [] };
          }
        });
      }
    };

    const result = await explainWithNeo4j(query, schema, session, { toolName: "test.py" }, { defaultLimit: 10 });

    assert.equal(result.ok, true);
    assert.equal(result.executed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.cypher.startsWith("EXPLAIN\nMATCH"), true);
    assert.equal(calls[0]?.cypher.endsWith("LIMIT 10"), true);
  });

  it("does not contact Neo4j when compiler diagnostics already block execution", async () => {
    let called = false;
    const session: Neo4jSessionLike = {
      async run() {
        called = true;
        return {};
      }
    };

    const result = await explainWithNeo4j(query, schema, session, {}, { defaultLimit: 10 });

    assert.equal(called, false);
    assert.equal(result.executed, false);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "missing-required-parameter"));
  });

  it("maps Neo4j driver errors into stable diagnostics", async () => {
    const error = Object.assign(new Error("Invalid input 'RETUR'"), {
      code: "Neo.ClientError.Statement.SyntaxError"
    });
    const session: Neo4jSessionLike = {
      async run() {
        throw error;
      }
    };

    const result = await explainWithNeo4j(query, schema, session, { toolName: "test.py" }, {
      defaultLimit: 10,
      useExecuteRead: false
    });

    assert.equal(result.ok, false);
    assert.equal(result.executed, true);
    assert.ok(result.diagnostics.some((item) => item.code === "neo4j-Neo.ClientError.Statement.SyntaxError"));
  });

  it("normalizes unknown thrown values", () => {
    assert.deepEqual(neo4jErrorDiagnostic("boom"), {
      code: "neo4j-Neo4j.ClientError.Statement.Unknown",
      severity: "error",
      message: "boom",
      suggestion: "Map this server error back into the LLM repair loop with the rendered Cypher and schema contract."
    });
  });
});
