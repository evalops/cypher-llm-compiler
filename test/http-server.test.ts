import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { createCompilerHttpServer, type CompilerHttpAuditEvent } from "../src/http-server.js";
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
    const agentGuide = await getJson(`${baseUrl}/v1/agent-guide`) as { version: string; workflows: unknown[] };
    const diagnosticCatalog = await getJson(`${baseUrl}/v1/diagnostic-catalog`) as { version: string; entries: unknown[] };
    const compatibility = await getJson(`${baseUrl}/v1/compatibility`) as { version: string; contracts: unknown[] };
    const conformance = await getJson(`${baseUrl}/v1/contract-conformance`) as { version: string; summary: { failures: number } };
    const openapi = await getJson(`${baseUrl}/v1/openapi`) as { version: string; openapi: string; paths: Record<string, unknown> };
    const metrics = await getJson(`${baseUrl}/v1/metrics`) as { version: string; requests: { total: number } };

    assert.equal(health.version, "cypher-llm-compiler-http/v1");
    assert.equal(health.tools, tools.tools.length);
    assert.ok(tools.tools.some((tool) => tool.name === "cypher_prove"));
    assert.ok(tools.tools.some((tool) => tool.name === "cypher_agent_feedback"));
    assert.equal(agentGuide.version, "cypher-llm-agent-guide/v1");
    assert.ok(agentGuide.workflows.length > 0);
    assert.equal(diagnosticCatalog.version, "cypher-llm-diagnostic-catalog/v1");
    assert.ok(diagnosticCatalog.entries.length > 0);
    assert.equal(compatibility.version, "cypher-llm-compatibility-catalog/v1");
    assert.ok(compatibility.contracts.length > 0);
    assert.equal(conformance.version, "cypher-llm-contract-conformance/v1");
    assert.equal(conformance.summary.failures, 0);
    assert.equal(openapi.version, "cypher-llm-service-openapi/v1");
    assert.equal(openapi.openapi, "3.1.0");
    assert.ok(openapi.paths["/v1/render"]);
    assert.equal(metrics.version, "cypher-llm-service-metrics/v1");
    assert.ok(metrics.requests.total >= 1);
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
    const losslessConformance = await postJson(`${baseUrl}/v1/lossless-conformance`, {}) as {
      version: string;
      summary: { failed: number };
    };
    const repairPlan = await postJson(`${baseUrl}/v1/repair-plan`, {
      schema,
      query,
      defaultLimit: 25
    }) as { version: string; deterministic: unknown[] };
    const feedback = await postJson(`${baseUrl}/v1/agent-feedback`, {
      schema,
      query,
      defaultLimit: 25
    }) as { version: string; nextAction: { kind: string } };
    const agentGuide = await postJson(`${baseUrl}/v1/agent-guide`, {}) as { version: string };
    const diagnosticCatalog = await postJson(`${baseUrl}/v1/diagnostic-catalog`, {}) as { version: string };
    const compatibility = await postJson(`${baseUrl}/v1/compatibility`, {}) as { version: string; contracts: unknown[] };
    const compatibilityDiff = await postJson(`${baseUrl}/v1/compatibility-diff`, {
      baseline: compatibility
    }) as { version: string; status: string };
    const conformance = await postJson(`${baseUrl}/v1/contract-conformance`, {}) as { version: string; summary: { failures: number } };
    const policy = await postJson(`${baseUrl}/v1/policy`, {
      schema,
      query,
      policyProfileId: "llm-readonly-strict"
    }) as { version: string; policy?: { id: string }; findings: { code: string }[] };
    const policyEval = await postJson(`${baseUrl}/v1/policy-eval`, {
      dataset: {
        version: "cypher-llm-eval-dataset/v1",
        name: "http-policy",
        tasks: [{ id: "one", question: "Return hash.", schema }]
      },
      attempts: {
        version: "cypher-llm-eval-attempts/v1",
        attempts: [{ taskId: "one", query }]
      },
      policyProfileId: "llm-readonly-strict",
      defaultLimit: 25
    }) as { version: string; summary: { warningAttempts: number; riskyExecutableAttempts: number } };
    const policyProfiles = await postJson(`${baseUrl}/v1/policy-profiles`, {}) as {
      version: string;
      profiles: { id: string }[];
    };
    const lsp = await postJson(`${baseUrl}/v1/lsp-diagnostics`, {
      schema,
      query,
      uri: "file:///query.json"
    }) as { version: string; codeActions: { title: string }[] };
    const evalReport = await postJson(`${baseUrl}/v1/eval`, {
      dataset: {
        version: "cypher-llm-eval-dataset/v1",
        name: "http-scorecard",
        tasks: [{ id: "one", question: "Return hash.", schema, expected: { canExecute: true } }]
      },
      attempts: {
        version: "cypher-llm-eval-attempts/v1",
        attempts: [{ taskId: "one", query }]
      },
      defaultLimit: 25
    }) as { version: string };
    const scorecard = await postJson(`${baseUrl}/v1/scorecard`, {
      reports: [evalReport],
      name: "http-scorecard"
    }) as { version: string; summary: { reports: number } };
    const gate = await postJson(`${baseUrl}/v1/benchmark-gate`, {
      baseline: evalReport,
      candidate: evalReport,
      minPassRate: 1
    }) as { version: string; status: string };
    const retryEval = await postJson(`${baseUrl}/v1/retry-eval`, {
      dataset: {
        version: "cypher-llm-eval-dataset/v1",
        name: "http-retry",
        tasks: [{ id: "one", question: "Return hash.", schema, expected: { canExecute: true } }]
      },
      rounds: [
        {
          id: "first",
          attempts: {
            version: "cypher-llm-eval-attempts/v1",
            attempts: [{ taskId: "one", noCypher: true }]
          }
        },
        {
          id: "second",
          attempts: {
            version: "cypher-llm-eval-attempts/v1",
            attempts: [{ taskId: "one", query }]
          }
        }
      ],
      defaultLimit: 25
    }) as { version: string; summary: { convergedTasks: number } };
    const governance = await postJson(`${baseUrl}/v1/dataset-governance`, {
      dataset: {
        version: "cypher-llm-eval-dataset/v1",
        name: "http-governance",
        tasks: [{ id: "one", question: "Return hash.", source: "repo smoke fixture", tags: ["split:smoke"], schema }]
      }
    }) as { version: string; ok: boolean };

    assert.equal(proof.version, "cypher-llm-proof/v1");
    assert.equal(proof.status, "repaired");
    assert.equal(proof.canExecute, true);
    assert.equal(rendered.canExecute, true);
    assert.equal(rendered.cypher, proof.cypher);
    assert.equal(lossless.version, "cypher-llm-lossless-parse/v1");
    assert.equal(lossless.roundTrip.ok, true);
    assert.equal(losslessConformance.version, "cypher-llm-lossless-conformance/v1");
    assert.equal(losslessConformance.summary.failed, 0);
    assert.equal(repairPlan.version, "cypher-llm-repair-plan/v1");
    assert.equal(repairPlan.deterministic.length, 1);
    assert.equal(feedback.version, "cypher-llm-agent-feedback/v1");
    assert.equal(feedback.nextAction.kind, "apply-deterministic-repairs");
    assert.equal(agentGuide.version, "cypher-llm-agent-guide/v1");
    assert.equal(diagnosticCatalog.version, "cypher-llm-diagnostic-catalog/v1");
    assert.equal(compatibility.version, "cypher-llm-compatibility-catalog/v1");
    assert.equal(compatibilityDiff.version, "cypher-llm-compatibility-diff/v1");
    assert.equal(compatibilityDiff.status, "passed");
    assert.equal(conformance.version, "cypher-llm-contract-conformance/v1");
    assert.equal(conformance.summary.failures, 0);
    assert.equal(policy.version, "cypher-llm-policy-report/v1");
    assert.equal(policy.policy?.id, "llm-readonly-strict");
    assert.deepEqual(policy.findings.map((finding) => finding.code), ["policy-unfiltered-label-scan", "policy-missing-limit"]);
    assert.equal(policyEval.version, "cypher-llm-policy-eval/v1");
    assert.equal(policyEval.summary.warningAttempts, 1);
    assert.equal(policyEval.summary.riskyExecutableAttempts, 1);
    assert.equal(policyProfiles.version, "cypher-llm-policy-profile-catalog/v1");
    assert.ok(policyProfiles.profiles.some((profile) => profile.id === "llm-readonly-strict"));
    assert.equal(lsp.version, "cypher-llm-lsp-diagnostics/v1");
    assert.ok(lsp.codeActions.some((action) => action.title === "Add a bounded LIMIT"));
    assert.equal(scorecard.version, "cypher-llm-cypherbench-scorecard/v1");
    assert.equal(scorecard.summary.reports, 1);
    assert.equal(gate.version, "cypher-llm-benchmark-gate/v1");
    assert.equal(gate.status, "passed");
    assert.equal(retryEval.version, "cypher-llm-retry-eval/v1");
    assert.equal(retryEval.summary.convergedTasks, 1);
    assert.equal(governance.version, "cypher-llm-dataset-governance/v1");
    assert.equal(governance.ok, true);
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

  it("tracks diagnostics, repairs, retry packets, and live database outcomes as service metrics", async () => {
    const metricsServer = createCompilerHttpServer({
      now: () => new Date("2026-05-10T00:00:01.000Z")
    });
    await new Promise<void>((resolve) => metricsServer.listen(0, "127.0.0.1", resolve));
    const address = metricsServer.address() as AddressInfo;
    const metricsBaseUrl = `http://127.0.0.1:${address.port}`;
    const diagnosticQuery: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [{
        kind: "match",
        patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
      }]
    };

    try {
      const validation = await postJson(`${metricsBaseUrl}/v1/validate`, {
        schema,
        query: diagnosticQuery
      }) as { diagnostics: unknown[] };
      const repairPlan = await postJson(`${metricsBaseUrl}/v1/repair-plan`, {
        schema,
        query,
        defaultLimit: 25
      }) as { deterministic: unknown[] };
      const feedback = await postJson(`${metricsBaseUrl}/v1/agent-feedback`, {
        schema,
        query,
        defaultLimit: 25
      }) as { version: string };
      const dialectCertification = await getJson(`${metricsBaseUrl}/v1/dialect-certification`) as { version: string };
      const failedRender = await fetch(`${metricsBaseUrl}/v1/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const metrics = await getJson(`${metricsBaseUrl}/v1/metrics`) as {
        version: string;
        requests: { total: number; failed: number; statusCodes: Record<string, number> };
        tools: { failed: number; byName: Array<{ name: string; diagnostics: number; repairs: number; retryPackets: number; failed: number }> };
        signals: {
          diagnostics: number;
          repairs: number;
          retryPackets: number;
          liveDatabaseOutcomes: { warning: number };
        };
      };

      assert.ok(validation.diagnostics.length > 0);
      assert.ok(repairPlan.deterministic.length > 0);
      assert.equal(feedback.version, "cypher-llm-agent-feedback/v1");
      assert.equal(dialectCertification.version, "cypher-llm-dialect-certification/v1");
      assert.equal(failedRender.status, 422);
      assert.equal(metrics.version, "cypher-llm-service-metrics/v1");
      assert.equal(metrics.requests.total, 5);
      assert.equal(metrics.requests.failed, 1);
      assert.equal(metrics.requests.statusCodes["422"], 1);
      assert.equal(metrics.tools.failed, 1);
      assert.ok(metrics.tools.byName.some((tool) => tool.name === "cypher_validate" && tool.diagnostics > 0));
      assert.ok(metrics.tools.byName.some((tool) => tool.name === "cypher_repair_plan" && tool.repairs > 0));
      assert.ok(metrics.tools.byName.some((tool) => tool.name === "cypher_agent_feedback" && tool.retryPackets === 1));
      assert.ok(metrics.tools.byName.some((tool) => tool.name === "cypher_render" && tool.failed === 1));
      assert.ok(metrics.signals.diagnostics > 0);
      assert.ok(metrics.signals.repairs > 0);
      assert.equal(metrics.signals.retryPackets, 1);
      assert.ok(metrics.signals.liveDatabaseOutcomes.warning >= 1);
    } finally {
      await new Promise<void>((resolve, reject) => metricsServer.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("enforces optional bearer auth and emits redacted audit events", async () => {
    const events: CompilerHttpAuditEvent[] = [];
    const secureServer = createCompilerHttpServer({
      authToken: "secret-token",
      auditSink: (event) => {
        events.push(event);
      },
      now: () => new Date("2026-05-10T00:00:00.000Z"),
      requestIdFactory: () => `req-${events.length + 1}`
    });
    await new Promise<void>((resolve) => secureServer.listen(0, "127.0.0.1", resolve));
    const address = secureServer.address() as AddressInfo;
    const secureBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const manifest = await getJson(`${secureBaseUrl}/v1/service-manifest`) as { auth: { required: boolean }; audit: { enabled: boolean } };
      const blocked = await fetch(`${secureBaseUrl}/v1/tools`);
      const rendered = await fetch(`${secureBaseUrl}/v1/render`, {
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/json",
          "x-request-id": "req-secure-render"
        },
        body: JSON.stringify({ schema, query, defaultLimit: 25 })
      });
      const renderedBody = await rendered.json() as { canExecute: boolean };

      assert.equal(manifest.auth.required, true);
      assert.equal(manifest.audit.enabled, true);
      assert.equal(blocked.status, 401);
      assert.equal(blocked.headers.get("www-authenticate"), "Bearer");
      assert.equal(rendered.status, 200);
      assert.equal(renderedBody.canExecute, true);
      assert.ok(events.some((event) => event.statusCode === 401 && event.errorCode === "unauthorized" && event.authRequired));
      const renderEvent = events.find((event) => event.requestId === "req-secure-render");
      assert.ok(renderEvent);
      assert.equal(renderEvent.authenticated, true);
      assert.equal(renderEvent.tool, "cypher_render");
      assert.equal(renderEvent.statusCode, 200);
      assert.ok(renderEvent.bodyBytes > 0);
      assert.equal("body" in renderEvent, false);
      assert.equal("query" in renderEvent, false);
    } finally {
      await new Promise<void>((resolve, reject) => secureServer.close((error) => (error ? reject(error) : resolve())));
    }
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
