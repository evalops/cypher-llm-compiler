import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import { buildCypherAgentWorkspace, type CypherAgentWorkspace } from "../src/agent-workspace.js";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("agent workspace packets", () => {
  it("combines LSP diagnostics, agent feedback, model instructions, and editor hints", () => {
    const workspace = buildCypherAgentWorkspace(
      readJson<CypherQuery>("examples/tool-hash.query.json"),
      readJson<CypherSchemaContract>("examples/tool-hash.schema.json"),
      readJson("examples/tool-hash.params.json"),
      { defaultLimit: 25, defaultMaxHops: 3, uri: "file:///examples/tool-hash.query.json" }
    );

    assert.equal(workspace.version, "cypher-llm-agent-workspace/v1");
    assert.equal(workspace.status, "repaired");
    assert.equal(workspace.nextAction.kind, "apply-deterministic-repairs");
    assert.equal(workspace.lsp.version, "cypher-llm-lsp-diagnostics/v1");
    assert.equal(workspace.agentFeedback.version, "cypher-llm-agent-feedback/v1");
    assert.ok(workspace.summary.codeActions > 0);
    assert.ok(workspace.editor.quickFixes.some((fix) => fix.title.includes("add-limit")));
    assert.ok(workspace.modelInstructions.some((instruction) => instruction.diagnosticCodes.includes("missing-limit")));
    assert.ok(workspace.contracts.includes("cypher-llm-agent-workspace/v1"));
  });

  it("keeps checked-in agent workspace JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const agentWorkspaceSchema = readJson("schemas/agent-workspace.schema.json");
    const checkedIn = readJson<CypherAgentWorkspace>("examples/agent/tool-hash.workspace.json");
    ajv.addSchema(agentWorkspaceSchema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/agent-workspace/v1.json");

    assert.ok(validate, "missing agent workspace schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(
      checkedIn,
      buildCypherAgentWorkspace(
        readJson<CypherQuery>("examples/tool-hash.query.json"),
        readJson<CypherSchemaContract>("examples/tool-hash.schema.json"),
        readJson("examples/tool-hash.params.json"),
        { defaultLimit: 25, defaultMaxHops: 3, uri: "file:///examples/tool-hash.query.json" }
      )
    );
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
