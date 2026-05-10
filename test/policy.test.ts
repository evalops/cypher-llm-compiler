import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";
import { assessCypherPolicy, type CypherPolicyReport } from "../src/policy.js";
import { getPolicyProfile, policyOptionsFromProfile } from "../src/policy-profile.js";
import { buildCypherProof } from "../src/proof.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

const schema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  dialect: "neo4j-cypher-25",
  nodes: [{ name: "Tool" }, { name: "Hash" }],
  relationships: [{ type: "HAS_HASH", from: "Tool", to: "Hash" }]
};

describe("cost and safety policy", () => {
  it("reports broad scans, high limits, cartesian patterns, and traversal risk", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        {
          kind: "match",
          patterns: [
            { segments: [{ variable: "tool", labels: ["Tool"] }] },
            {
              segments: [
                { variable: "hash", labels: ["Hash"] },
                { rel: { types: ["HAS_HASH"], direction: "in", minHops: 1, maxHops: 10 }, node: { variable: "other", labels: ["Tool"] } }
              ]
            }
          ]
        },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 500 } }
      ]
    };
    const report = assessCypherPolicy(query, schema, { maxRelationshipHops: 5, maxReturnLimit: 100 });
    const codes = report.findings.map((finding) => finding.code);

    assert.equal(report.ok, true);
    assert.ok(codes.includes("policy-cartesian-pattern-risk"));
    assert.ok(codes.includes("policy-unfiltered-label-scan"));
    assert.ok(codes.includes("policy-high-hop-traversal"));
    assert.ok(codes.includes("policy-high-return-limit"));
  });

  it("blocks writes and unbounded traversals by policy", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        {
          kind: "match",
          patterns: [
            {
              segments: [
                { variable: "tool", labels: ["Tool"] },
                { rel: { types: ["HAS_HASH"], direction: "out", minHops: 1, maxHops: null }, node: { variable: "hash", labels: ["Hash"] } }
              ]
            }
          ]
        },
        { kind: "delete", expressions: [{ kind: "var", name: "hash" }] }
      ]
    };
    const report = assessCypherPolicy(query, schema);

    assert.equal(report.ok, false);
    assert.ok(report.findings.some((finding) => finding.code === "policy-write-risk"));
    assert.ok(report.findings.some((finding) => finding.code === "policy-unbounded-traversal"));
  });

  it("records the selected policy profile in reports", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
        },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 400 } }
      ]
    };
    const report = assessCypherPolicy(query, schema, policyOptionsFromProfile(getPolicyProfile("llm-readonly-exploration")));

    assert.equal(report.policy?.id, "llm-readonly-exploration");
    assert.equal(report.findings.some((finding) => finding.code === "policy-high-return-limit"), false);
  });

  it("feeds policy claims into proof output after deterministic repairs", () => {
    const proof = buildCypherProof(readJson<CypherQuery>("examples/tool-hash.query.json"), readJson<CypherSchemaContract>("examples/tool-hash.schema.json"), readJson("examples/tool-hash.params.json"), {
      defaultLimit: 25,
      defaultMaxHops: 3
    });

    assert.equal(proof.claims.find((claim) => claim.id === "cost-safety-policy")?.status, "passed");
  });

  it("keeps checked-in policy JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const policySchema = readJson("schemas/policy-report.schema.json");
    const checkedIn = readJson<CypherPolicyReport>("examples/policy/tool-hash.policy.json");
    ajv.addSchema(policySchema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/policy-report/v1.json");

    assert.ok(validate, "missing policy report schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(
      checkedIn,
      assessCypherPolicy(readJson<CypherQuery>("examples/tool-hash.query.json"), readJson<CypherSchemaContract>("examples/tool-hash.schema.json"))
    );
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
