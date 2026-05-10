import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import { buildCypherAgentFeedback, type CypherAgentFeedback } from "../src/agent-feedback.js";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";

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

describe("agent feedback packets", () => {
  it("combines proof, repair plan, policy evidence, and next action", () => {
    const feedback = buildCypherAgentFeedback(repairableQuery, schema, {}, { defaultLimit: 25, defaultMaxHops: 3 });

    assert.equal(feedback.version, "cypher-llm-agent-feedback/v1");
    assert.equal(feedback.status, "repaired");
    assert.equal(feedback.canExecute, true);
    assert.equal(feedback.nextAction.kind, "apply-deterministic-repairs");
    assert.equal(feedback.policyEvidence.ok, true);
    assert.ok(feedback.repairKinds.includes("add-limit"));
    assert.equal(
      feedback.diagnosticActions.find((action) => action.code === "missing-limit")?.preferredAction,
      "apply-deterministic-repair"
    );
    assert.equal(feedback.proof.status, "repaired");
    assert.equal(feedback.repairPlan.status, "ready");
  });

  it("asks for approval when write policy blocks execution", () => {
    const writeQuery: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-write",
      clauses: [
        { kind: "create", patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }] },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 1 } }
      ]
    };
    const feedback = buildCypherAgentFeedback(writeQuery, schema);

    assert.equal(feedback.status, "blocked");
    assert.equal(feedback.nextAction.kind, "request-approval");
    assert.ok(feedback.nextAction.diagnosticCodes.includes("policy-write-risk"));
    assert.equal(
      feedback.diagnosticActions.find((action) => action.code === "policy-write-risk")?.preferredAction,
      "request-approval"
    );
  });

  it("keeps checked-in agent feedback JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const agentFeedbackSchema = readJson("schemas/agent-feedback.schema.json");
    const checkedIn = readJson<CypherAgentFeedback>("examples/proofs/tool-hash.agent-feedback.json");
    ajv.addSchema(agentFeedbackSchema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/agent-feedback/v1.json");

    assert.ok(validate, "missing agent feedback schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(
      checkedIn,
      buildCypherAgentFeedback(
        readJson<CypherQuery>("examples/tool-hash.query.json"),
        readJson<CypherSchemaContract>("examples/tool-hash.schema.json"),
        readJson("examples/tool-hash.params.json"),
        { defaultLimit: 25, defaultMaxHops: 3 }
      )
    );
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
