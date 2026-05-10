import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";
import { buildCypherRepairPlan } from "../src/repair-plan.js";

const schema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  dialect: "neo4j-cypher-25",
  nodes: [
    { name: "Tool", aliases: ["tool"], properties: { name: { type: "STRING" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [{ type: "has MD5 hash", aliases: ["md5"], from: "Tool", to: "Hash" }]
};

const repairableQuery: CypherQuery = {
  version: "cypher-llm-ir/v1",
  profile: "llm-safe-readonly",
  clauses: [
    {
      kind: "match",
      patterns: [
        {
          segments: [
            { variable: "tool", labels: ["tool"] },
            {
              rel: { types: ["md5"], direction: "in", minHops: 1, maxHops: null },
              node: { variable: "hash", labels: ["Hash"] }
            }
          ]
        }
      ]
    },
    { kind: "return", items: [{ expression: { kind: "var", name: "hash" } }] }
  ]
};

describe("repair plans", () => {
  it("ranks deterministic repairs as JSON-patch steps", () => {
    const plan = buildCypherRepairPlan(repairableQuery, schema, { defaultLimit: 25, defaultMaxHops: 3 });

    assert.equal(plan.version, "cypher-llm-repair-plan/v1");
    assert.equal(plan.status, "ready");
    assert.deepEqual(
      plan.deterministic.map((step) => step.patch?.path),
      [
        "/clauses/0/patterns/0/segments/0/labels/0",
        "/clauses/0/patterns/0/segments/1/rel/types/0",
        "/clauses/0/patterns/0/segments/1/rel/direction",
        "/clauses/0/patterns/0/segments/1/rel/maxHops",
        "/clauses/1/limit"
      ]
    );
    assert.equal(plan.summary.modelRequired, 0);
    assert.equal(plan.summary.unsafe, 0);
    assert.ok(plan.cypherAfter.includes("LIMIT 25"));
  });

  it("separates model-required diagnostics from deterministic repairs", () => {
    const badQuery: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "missing" } }]
        }
      ]
    };
    const plan = buildCypherRepairPlan(badQuery, schema);

    assert.equal(plan.status, "needs-model");
    assert.ok(plan.modelRequired.some((step) => step.diagnostics.some((item) => item.code === "undefined-variable")));
    assert.equal(plan.summary.deterministic, 0);
  });

  it("blocks unsafe write plans instead of auto-repairing them", () => {
    const writeQuery: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        {
          kind: "create",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
        },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }] }
      ]
    };
    const plan = buildCypherRepairPlan(writeQuery, schema, { defaultLimit: 10 });

    assert.equal(plan.status, "blocked");
    assert.ok(plan.unsafe.some((step) => step.diagnostics.some((item) => item.code === "policy-write-risk")));
  });

  it("classifies policy-rule blockers as unsafe repair steps", () => {
    const sensitiveReturnQuery: CypherQuery = {
      ...repairableQuery,
      clauses: [
        repairableQuery.clauses[0]!,
        { kind: "return", items: [{ expression: { kind: "prop", object: { kind: "var", name: "hash" }, key: "value" } }] }
      ]
    };
    const plan = buildCypherRepairPlan(sensitiveReturnQuery, schema, {
      defaultLimit: 25,
      defaultMaxHops: 3,
      policyRules: {
        version: "cypher-llm-policy-rules/v1",
        id: "repair-rules",
        sensitiveProperties: [{ ownerKind: "node", owner: "Hash", property: "value", severity: "error" }],
        tenantScopes: [{ label: "Tool", property: "tenantId", parameter: "tenantId", severity: "error" }]
      }
    });

    assert.equal(plan.status, "blocked");
    assert.ok(plan.unsafe.some((step) => step.diagnostics.some((item) => item.code === "policy-missing-tenant-scope")));
    assert.ok(plan.unsafe.some((step) => step.diagnostics.some((item) => item.code === "policy-sensitive-property-return")));
  });

  it("keeps checked-in repair plan JSON aligned with runtime data", () => {
    const query = readJson<CypherQuery>("examples/tool-hash.query.json");
    const schemaContract = readJson<CypherSchemaContract>("examples/tool-hash.schema.json");
    const params = readJson<Record<string, string>>("examples/tool-hash.params.json");
    const expected = readJson("examples/proofs/tool-hash.repair-plan.json");
    const regenerated = buildCypherRepairPlan(query, schemaContract, { params, defaultLimit: 25, defaultMaxHops: 3 });

    assert.deepEqual(regenerated, expected);
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
