import assert from "node:assert/strict";
import { describe, it } from "node:test";
import neo4j from "neo4j-driver";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";
import { explainWithNeo4j, type Neo4jSessionLike } from "../src/neo4j-explain.js";

const uri = process.env.CYPHER_LLM_NEO4J_URI;
const user = process.env.CYPHER_LLM_NEO4J_USER ?? "neo4j";
const password = process.env.CYPHER_LLM_NEO4J_PASSWORD;
const shouldRun = Boolean(uri && password);

const schema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  dialect: "neo4j-cypher-25",
  nodes: [
    { name: "Tool", properties: { name: { type: "STRING" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [{ type: "has MD5 hash", from: "Tool", to: "Hash" }],
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
            },
            {
              rel: { types: ["has MD5 hash"], direction: "out" },
              node: { variable: "hash", labels: ["Hash"] }
            }
          ]
        }
      ]
    },
    {
      kind: "return",
      items: [{ expression: { kind: "prop", object: { kind: "var", name: "hash" }, key: "value" }, alias: "md5" }]
    }
  ]
};

describe("Neo4j live EXPLAIN fixture", { skip: shouldRun ? false : "Set CYPHER_LLM_NEO4J_URI and CYPHER_LLM_NEO4J_PASSWORD to run live Neo4j tests." }, () => {
  it("runs representative compiler output through real Neo4j EXPLAIN", async () => {
    const driver = neo4j.driver(uri as string, neo4j.auth.basic(user, password as string));
    const session = driver.session();
    try {
      const result = await explainWithNeo4j(
        query,
        schema,
        session as unknown as Neo4jSessionLike,
        { toolName: "cypher-llm" },
        { defaultLimit: 10 }
      );

      assert.equal(result.ok, true);
      assert.equal(result.executed, true);
      assert.equal(result.plan.cypher.includes("LIMIT 10"), true);
      assert.equal(result.summary !== undefined, true);
    } finally {
      await session.close();
      await driver.close();
    }
  });

  it("maps live Neo4j server errors into compiler diagnostics", async () => {
    const driver = neo4j.driver(uri as string, neo4j.auth.basic(user, password as string));
    const session = driver.session();
    const invalidQuery: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "return",
          items: [{ expression: { kind: "raw", cypher: "definitely_missing_function()" }, alias: "bad" }],
          limit: { kind: "literal", value: 1 }
        }
      ]
    };

    try {
      const result = await explainWithNeo4j(invalidQuery, schema, session as unknown as Neo4jSessionLike, {
        toolName: "cypher-llm"
      });

      assert.equal(result.ok, false);
      assert.equal(result.executed, true);
      assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("neo4j-")));
    } finally {
      await session.close();
      await driver.close();
    }
  });
});
