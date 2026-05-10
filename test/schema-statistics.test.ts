import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildSchemaStatisticsSkeleton, findNodeStatistics, findRelationshipStatistics } from "../src/schema-statistics.js";

describe("schema statistics", () => {
  it("builds a statistics skeleton from schema contracts", () => {
    const statistics = buildSchemaStatisticsSkeleton({
      version: "cypher-llm-schema/v1",
      nodes: [{ name: "Tool" }],
      relationships: [{ type: "HAS_HASH", from: "Tool", to: "Hash" }]
    });

    assert.equal(statistics.version, "cypher-llm-schema-statistics/v1");
    assert.deepEqual(statistics.nodes, [{ label: "Tool" }]);
    assert.deepEqual(statistics.relationships, [{ type: "HAS_HASH" }]);
  });

  it("looks up checked-in label and relationship statistics", () => {
    const statistics = JSON.parse(
      readFileSync(path.join(process.cwd(), "examples/policy/tool-hash.schema-statistics.json"), "utf8")
    ) as ReturnType<typeof buildSchemaStatisticsSkeleton>;

    assert.equal(findNodeStatistics(statistics, "Tool")?.count, 25_000);
    assert.equal(findRelationshipStatistics(statistics, "has MD5 hash")?.averageFanout, 1);
  });
});
