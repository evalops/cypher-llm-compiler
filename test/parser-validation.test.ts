import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";
import {
  dbSchemaFromContract,
  validateCypherTextWithParser,
  validateRenderedQueryWithParser
} from "../src/parser-validation.js";

const schema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  nodes: [
    { name: "Tool", properties: { name: { type: "STRING" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [{ type: "has MD5 hash", from: "Tool", to: "Hash" }],
  parameters: { toolName: "STRING" }
};

describe("parser-backed validation", () => {
  it("adapts schema contracts into Neo4j language-support db schemas", () => {
    const dbSchema = dbSchemaFromContract(schema);

    assert.deepEqual(dbSchema.labels, ["`Hash`", "`Tool`", "Hash", "Tool"]);
    assert.ok(dbSchema.relationshipTypes?.includes("`has MD5 hash`"));
    assert.ok(dbSchema.propertyKeys?.includes("`value`"));
    assert.deepEqual(dbSchema.parameters, { toolName: true });
  });

  it("accepts rendered IR that uses backtick-escaped identifiers", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [
            {
              segments: [
                { variable: "tool", labels: ["Tool"], properties: { name: { kind: "param", name: "toolName" } } },
                { rel: { types: ["has MD5 hash"], direction: "out" }, node: { variable: "hash", labels: ["Hash"] } }
              ]
            }
          ]
        },
        {
          kind: "return",
          items: [{ expression: { kind: "prop", object: { kind: "var", name: "hash" }, key: "value" } }],
          limit: { kind: "literal", value: 25 }
        }
      ]
    };

    const result = validateRenderedQueryWithParser(query, schema);

    assert.equal(result.ok, true);
    assert.deepEqual(result.diagnostics, []);
  });

  it("maps parser errors into stable diagnostics", () => {
    const result = validateCypherTextWithParser("MATCH (n RETURN n", schema, { mode: "syntax" });

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0]?.code, "cypher-parser-error");
    assert.equal(result.diagnostics[0]?.severity, "error");
    assert.match(result.diagnostics[0]?.path ?? "", /^line:1:character:/);
  });
});
