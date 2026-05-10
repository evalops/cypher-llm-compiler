import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { introspectNeo4jSchema, type Neo4jIntrospectionRecordLike } from "../src/neo4j-introspect.js";

class FakeRecord implements Neo4jIntrospectionRecordLike {
  constructor(private readonly values: Record<string, unknown>) {}

  get(key: string | number): unknown {
    if (typeof key !== "string" || !(key in this.values)) {
      throw new Error(`missing key ${String(key)}`);
    }
    return this.values[key];
  }

  toObject(): Record<string, unknown> {
    return this.values;
  }
}

describe("Neo4j schema introspection", () => {
  it("builds a schema contract from driver-compatible records", async () => {
    const seen: string[] = [];
    const session = {
      async run(cypher: string, params?: Record<string, unknown>) {
        seen.push(cypher);
        if (cypher.includes("nodeTypeProperties")) {
          return {
            records: [
              new FakeRecord({ nodeType: ":`Tool`", propertyName: "name", propertyTypes: ["String"], mandatory: true }),
              new FakeRecord({ nodeType: ":`Hash`", propertyName: "value", propertyTypes: ["String"], mandatory: false })
            ]
          };
        }
        if (cypher.includes("relTypeProperties")) {
          return {
            records: [
              new FakeRecord({
                relType: ":`has MD5 hash`",
                propertyName: "source",
                propertyTypes: ["String"],
                mandatory: false
              })
            ]
          };
        }
        if (cypher.includes("MATCH (from)-[rel]->(to)")) {
          assert.equal(params?.sampleLimit, 50);
          return {
            records: [new FakeRecord({ fromLabels: ["Tool"], type: "has MD5 hash", toLabels: ["Hash"] })]
          };
        }
        if (cypher.includes("SHOW PROCEDURES")) {
          return {
            records: [
              new FakeRecord({
                name: "db.indexes",
                description: "List indexes.",
                returnDescription: "name :: STRING?, type :: STRING?"
              })
            ]
          };
        }
        return { records: [] };
      }
    };

    const schema = await introspectNeo4jSchema(session, { sampleLimit: 50 });

    assert.equal(schema.version, "cypher-llm-schema/v1");
    assert.deepEqual(schema.nodes, [
      { name: "Tool", properties: { name: { type: "STRING", nullable: false } } },
      { name: "Hash", properties: { value: { type: "STRING", nullable: true } } }
    ]);
    assert.deepEqual(schema.relationships, [
      {
        type: "has MD5 hash",
        from: "Tool",
        to: "Hash",
        properties: { source: { type: "STRING", nullable: true } }
      }
    ]);
    assert.deepEqual(schema.procedures?.["db.indexes"]?.yields, { name: "STRING", type: "STRING" });
    assert.equal(seen.length, 4);
  });
});
