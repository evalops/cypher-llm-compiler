import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { createCompilerHttpServer } from "../src/http-server.js";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";

const schema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  dialect: "neo4j-cypher-25",
  nodes: [
    { name: "Tool", properties: { name: { type: "STRING" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [{ type: "HAS_HASH", from: "Tool", to: "Hash" }]
};

const query: CypherQuery = {
  version: "cypher-llm-ir/v1",
  profile: "llm-safe-readonly",
  clauses: [
    {
      kind: "match",
      patterns: [
        {
          segments: [
            { variable: "tool", labels: ["Tool"] },
            { rel: { types: ["HAS_HASH"], direction: "out" }, node: { variable: "hash", labels: ["Hash"] } }
          ]
        }
      ]
    },
    { kind: "return", items: [{ expression: { kind: "var", name: "hash" } }] }
  ]
};

describe("compiler HTTP service", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createCompilerHttpServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("serves health and tool metadata", async () => {
    const health = await getJson(`${baseUrl}/healthz`) as { version: string; tools: number };
    const tools = await getJson(`${baseUrl}/v1/tools`) as { tools: { name: string }[] };

    assert.equal(health.version, "cypher-llm-compiler-http/v1");
    assert.equal(health.tools, tools.tools.length);
    assert.ok(tools.tools.some((tool) => tool.name === "cypher_prove"));
  });

  it("runs compiler tools through stable HTTP routes", async () => {
    const proof = await postJson(`${baseUrl}/v1/prove`, {
      schema,
      query,
      defaultLimit: 25,
      parserMode: "syntax"
    }) as { version: string; status: string; canExecute: boolean; cypher: string };
    const rendered = await postJson(`${baseUrl}/v1/tools/cypher_render`, {
      schema,
      query,
      defaultLimit: 25
    }) as { canExecute: boolean; cypher: string };
    const lossless = await postJson(`${baseUrl}/v1/parse-lossless`, {
      schema,
      rawCypher: "MATCH (tool:Tool)-[:HAS_HASH]->(hash:Hash) RETURN hash"
    }) as { version: string; roundTrip: { ok: boolean } };
    const policy = await postJson(`${baseUrl}/v1/policy`, {
      schema,
      query
    }) as { version: string; findings: { code: string }[] };
    const lsp = await postJson(`${baseUrl}/v1/lsp-diagnostics`, {
      schema,
      query,
      uri: "file:///query.json"
    }) as { version: string; codeActions: { title: string }[] };

    assert.equal(proof.version, "cypher-llm-proof/v1");
    assert.equal(proof.status, "repaired");
    assert.equal(proof.canExecute, true);
    assert.equal(rendered.canExecute, true);
    assert.equal(rendered.cypher, proof.cypher);
    assert.equal(lossless.version, "cypher-llm-lossless-parse/v1");
    assert.equal(lossless.roundTrip.ok, true);
    assert.equal(policy.version, "cypher-llm-policy-report/v1");
    assert.deepEqual(policy.findings.map((finding) => finding.code), ["policy-unfiltered-label-scan", "policy-missing-limit"]);
    assert.equal(lsp.version, "cypher-llm-lsp-diagnostics/v1");
    assert.ok(lsp.codeActions.some((action) => action.title === "Add a bounded LIMIT"));
  });

  it("returns structured errors for invalid tool input", async () => {
    const response = await fetch(`${baseUrl}/v1/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 422);
    assert.equal(body.error.code, "compiler-tool-error");
  });
});

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return response.json();
}
