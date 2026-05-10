import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";
import { buildCypherProof, type CypherProof } from "../src/proof.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

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
            { rel: { types: ["md5"], direction: "in", minHops: 1, maxHops: null }, node: { variable: "hash", labels: ["Hash"] } }
          ]
        }
      ]
    },
    { kind: "return", items: [{ expression: { kind: "var", name: "hash" } }] }
  ]
};

describe("proof-carrying Cypher compilation", () => {
  it("emits proof claims for repaired executable queries", () => {
    const proof = buildCypherProof(repairableQuery, schema, {}, { defaultLimit: 25, defaultMaxHops: 3 });

    assert.equal(proof.version, "cypher-llm-proof/v1");
    assert.equal(proof.status, "repaired");
    assert.equal(proof.canExecute, true);
    assert.equal(proof.requiresApproval, false);
    assert.ok(proof.preflightCypher.startsWith("EXPLAIN\nMATCH"));
    assert.deepEqual(proof.repairKinds, ["canonicalize-identifier", "fix-direction", "bound-path", "add-limit"]);
    assert.equal(proof.claims.find((claim) => claim.id === "parser-preflight")?.status, "passed");
  });

  it("blocks proof output for writes without approval", () => {
    const writeQuery: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-write",
      clauses: [
        { kind: "create", patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }] },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 1 } }
      ]
    };
    const proof = buildCypherProof(writeQuery, schema);

    assert.equal(proof.status, "blocked");
    assert.equal(proof.canExecute, false);
    assert.ok(proof.diagnosticCodes.includes("execution-approval-required"));
    assert.equal(proof.claims.find((claim) => claim.id === "execution-policy")?.status, "failed");
  });

  it("feeds policy evidence into proof claims", () => {
    const proof = buildCypherProof(repairableQuery, schema, {}, {
      defaultLimit: 25,
      defaultMaxHops: 3,
      policyRules: {
        version: "cypher-llm-policy-rules/v1",
        id: "proof-rules",
        sensitiveLabels: [{ label: "Hash", severity: "warning" }],
        tenantScopes: [{ label: "Tool", property: "tenantId", parameter: "tenantId", severity: "error" }]
      },
      schemaStatistics: {
        version: "cypher-llm-schema-statistics/v1",
        source: "fixture",
        nodes: [{ label: "Tool", count: 25_000 }],
        relationships: [{ type: "has MD5 hash", averageFanout: 250 }]
      }
    });
    const policyClaim = proof.claims.find((claim) => claim.id === "cost-safety-policy");

    assert.equal(proof.status, "blocked");
    assert.equal(policyClaim?.status, "failed");
    assert.ok(proof.diagnosticCodes.includes("policy-missing-tenant-scope"));
    assert.ok(proof.diagnosticCodes.includes("policy-sensitive-label-access"));
    assert.ok(proof.diagnosticCodes.includes("policy-high-fanout-relationship"));
  });

  it("keeps checked-in proof JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const proofSchema = readJson("schemas/cypher-proof.schema.json");
    const checkedIn = readJson<CypherProof>("examples/proofs/tool-hash.proof.json");
    ajv.addSchema(proofSchema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/proof/v1.json");

    assert.ok(validate, "missing proof schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(
      checkedIn,
      buildCypherProof(readJson<CypherQuery>("examples/tool-hash.query.json"), readJson<CypherSchemaContract>("examples/tool-hash.schema.json"), readJson("examples/tool-hash.params.json"), {
        defaultLimit: 25,
        defaultMaxHops: 3
      })
    );
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
