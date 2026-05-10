import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderQuery } from "../src/render.js";
import { normalizeSchema } from "../src/schema.js";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";

describe("renderer", () => {
  it("escapes schema identifiers that routinely break LLM generated Cypher", () => {
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
                  properties: {
                    name: { kind: "param", name: "toolName" }
                  }
                },
                {
                  rel: {
                    types: ["has MD5 hash"],
                    direction: "out"
                  },
                  node: {
                    variable: "hash",
                    labels: ["Hash Value"]
                  }
                }
              ]
            }
          ]
        },
        {
          kind: "return",
          items: [
            {
              expression: {
                kind: "prop",
                object: { kind: "var", name: "hash" },
                key: "hash value"
              },
              alias: "md5"
            }
          ],
          limit: { kind: "literal", value: 25 }
        }
      ]
    };

    assert.equal(
      renderQuery(query),
      [
        "MATCH (tool:`Tool` {`name`: $toolName})-[:`has MD5 hash`]->(hash:`Hash Value`)",
        "RETURN hash.`hash value` AS md5",
        "LIMIT 25"
      ].join("\n")
    );
  });

  it("renders deterministic maps and properties", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        {
          kind: "return",
          items: [
            {
              expression: {
                kind: "map",
                entries: {
                  z: { kind: "literal", value: 1 },
                  a: { kind: "literal", value: "first" }
                }
              },
              alias: "payload"
            }
          ]
        }
      ]
    };

    assert.equal(renderQuery(query), "RETURN {`a`: 'first', `z`: 1} AS payload");
  });
});

describe("schema normalization", () => {
  it("keeps canonical names and aliases available to tools", () => {
    const schema: CypherSchemaContract = {
      version: "cypher-llm-schema/v1",
      nodes: [
        {
          name: "Source File",
          aliases: ["file"],
          properties: {
            "file path": {
              type: "STRING",
              aliases: ["path"]
            }
          }
        }
      ],
      relationships: [
        {
          type: "has MD5 hash",
          aliases: ["md5"],
          from: "Source File",
          to: "Hash"
        }
      ]
    };

    const normalized = normalizeSchema(schema);

    assert.equal(normalized.labelAliases.get("file"), "Source File");
    assert.equal(normalized.relationshipAliases.get("md5"), "has MD5 hash");
    assert.equal(normalized.identifiers.labels.get("Source File")?.cypher, "`Source File`");
  });
});
