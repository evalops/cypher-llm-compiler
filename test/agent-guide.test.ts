import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import { buildAgentGuide, renderAgentGuideMarkdown, type AgentGuide } from "../src/agent-guide.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("agent guide", () => {
  it("defines LLM-facing workflows, defaults, and diagnostic playbooks", () => {
    const guide = buildAgentGuide();

    assert.equal(guide.version, "cypher-llm-agent-guide/v1");
    assert.equal(guide.authoringRules.preferredInput, "cypher-llm-ir/v1");
    assert.equal(guide.authoringRules.requiredDefaults.defaultLimit, 25);
    assert.ok(guide.workflows.some((workflow) => workflow.id === "author-read-query"));
    assert.ok(guide.workflows.some((workflow) => workflow.id === "release-compatibility"));
    assert.ok(
      guide.workflows.some((workflow) =>
        workflow.steps.some((step) => step.toolName === "cypher_lossless_conformance")
      )
    );
    assert.ok(
      guide.workflows.some((workflow) =>
        workflow.steps.some((step) => step.toolName === "cypher_policy_eval")
      )
    );
    assert.ok(guide.publicContracts.includes("cypher-llm-policy-eval/v1"));
    assert.ok(guide.publicContracts.includes("cypher-llm-lossless-conformance/v1"));
    assert.ok(guide.diagnosticPlaybooks.some((playbook) => playbook.codes.includes("missing-limit")));
    assert.ok(guide.diagnosticPlaybooks.some((playbook) => playbook.preferredAction === "request-approval"));
  });

  it("renders a markdown agent guide", () => {
    const markdown = renderAgentGuideMarkdown();

    assert.ok(markdown.includes("# Cypher LLM Agent Guide"));
    assert.ok(markdown.includes("cypher_agent_feedback"));
    assert.ok(markdown.includes("missing-limit"));
  });

  it("keeps checked-in agent guide JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = readJson("schemas/agent-guide.schema.json");
    const checkedIn = readJson<AgentGuide>("examples/agent/agent-guide.json");
    ajv.addSchema(schema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/agent-guide/v1.json");

    assert.ok(validate, "missing agent guide schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(checkedIn, buildAgentGuide());
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
