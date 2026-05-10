import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";
import { createLangChainCypherAdapter } from "../src/langchain.js";
import { handleMcpRequest } from "../src/mcp-server.js";
import { executeCypherCompilerTool, getOpenAiChatTools, getOpenAiResponsesTools } from "../src/tools.js";

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
    {
      kind: "return",
      items: [{ expression: { kind: "var", name: "hash" } }]
    }
  ]
};

describe("OpenAI tool schemas", () => {
  it("exports stable function definitions for every compiler operation", () => {
    const responseTools = getOpenAiResponsesTools();
    const chatTools = getOpenAiChatTools();
    const names = responseTools.map((tool) => tool.name);

    assert.deepEqual(names, [
      "cypher_render",
      "cypher_validate",
      "cypher_repair",
      "cypher_repair_plan",
      "cypher_parse_lossless",
      "cypher_parse_check",
      "cypher_policy_check",
      "cypher_policy_profiles",
      "cypher_lsp_diagnostics",
      "cypher_prove",
      "cypher_agent_feedback",
      "cypher_eval",
      "cypher_scorecard",
      "cypher_benchmark_gate",
      "cypher_dataset_governance"
    ]);
    assert.equal(chatTools[0]?.function.name, "cypher_render");
    assert.equal(responseTools.every((tool) => tool.type === "function" && tool.parameters.type === "object"), true);
    const toolsByName = Object.fromEntries(responseTools.map((tool) => [tool.name, tool]));
    const renderProperties = toolsByName.cypher_render?.parameters.properties as Record<string, unknown>;
    const repairPlanProperties = toolsByName.cypher_repair_plan?.parameters.properties as Record<string, unknown>;
    const proveProperties = toolsByName.cypher_prove?.parameters.properties as Record<string, unknown>;
    assert.equal("policyRules" in renderProperties, false);
    assert.equal("policyRules" in repairPlanProperties, true);
    assert.equal("maxReturnLimit" in proveProperties, true);
  });

  it("executes the render and parse-check tools through the shared dispatcher", async () => {
    const rendered = (await executeCypherCompilerTool("cypher_render", {
      schema,
      query: repairableQuery,
      defaultLimit: 25,
      defaultMaxHops: 3
    })) as { cypher: string; repairs: { kind: string }[]; canExecute: boolean };

    assert.equal(rendered.canExecute, true);
    assert.equal(rendered.cypher, "MATCH (tool:`Tool`)-[:`has MD5 hash`*1..3]->(hash:`Hash`)\nRETURN hash\nLIMIT 25");
    assert.deepEqual(
      rendered.repairs.map((repair) => repair.kind),
      ["canonicalize-identifier", "canonicalize-identifier", "fix-direction", "bound-path", "add-limit"]
    );

    const parsed = (await executeCypherCompilerTool("cypher_parse_check", {
      schema,
      query: repairableQuery,
      defaultLimit: 25,
      defaultMaxHops: 3,
      mode: "syntax"
    })) as { ok: boolean; diagnostics: unknown[] };

    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.diagnostics, []);

    const lossless = (await executeCypherCompilerTool("cypher_parse_lossless", {
      schema,
      rawCypher: "MATCH (tool:Tool)-[:`has MD5 hash`]->(hash:Hash) RETURN hash.value",
      parserMode: "syntax"
    })) as { version: string; roundTrip: { ok: boolean }; irPreview?: { supportedClauses: number } };

    assert.equal(lossless.version, "cypher-llm-lossless-parse/v1");
    assert.equal(lossless.roundTrip.ok, true);
    assert.equal(lossless.irPreview?.supportedClauses, 2);

    const repairPlan = (await executeCypherCompilerTool("cypher_repair_plan", {
      schema,
      query: repairableQuery,
      defaultLimit: 25,
      defaultMaxHops: 3,
      parserMode: "syntax",
      policyRules: {
        version: "cypher-llm-policy-rules/v1",
        id: "repair-tool-policy",
        sensitiveLabels: [{ label: "Hash", severity: "warning" }]
      }
    })) as {
      version: string;
      deterministic: { patch?: { path: string } }[];
      diagnostics: { code: string }[];
      policyEvidence: { findingCodes: string[] };
    };

    assert.equal(repairPlan.version, "cypher-llm-repair-plan/v1");
    assert.ok(repairPlan.deterministic.some((step) => step.patch?.path === "/clauses/1/limit"));
    assert.ok(repairPlan.diagnostics.some((diagnostic) => diagnostic.code === "policy-sensitive-label-access"));
    assert.ok(repairPlan.policyEvidence.findingCodes.includes("policy-sensitive-label-access"));

    const policy = (await executeCypherCompilerTool("cypher_policy_check", {
      schema,
      query: repairableQuery,
      policyProfileId: "llm-readonly-strict",
      plannerEstimate: {
        version: "cypher-llm-planner-estimate/v1",
        source: "fixture",
        estimatedRows: 25_000,
        operators: [{ name: "NodeByLabelScan", estimatedRows: 25_000 }]
      },
      schemaStatistics: {
        version: "cypher-llm-schema-statistics/v1",
        source: "fixture",
        nodes: [{ label: "Tool", count: 25_000 }],
        relationships: [{ type: "has MD5 hash", averageFanout: 250 }]
      },
      policyRules: {
        version: "cypher-llm-policy-rules/v1",
        id: "tool-policy",
        sensitiveLabels: [{ label: "Hash", severity: "warning" }],
        sensitiveRelationships: [{ type: "has MD5 hash", severity: "warning" }],
        tenantScopes: [{ label: "Tool", property: "tenantId", parameter: "tenantId", severity: "error" }]
      },
      maxRelationshipHops: 3
    })) as { version: string; policy?: { id: string }; findings: { code: string }[] };

    assert.equal(policy.version, "cypher-llm-policy-report/v1");
    assert.equal(policy.policy?.id, "llm-readonly-strict");
    assert.ok(policy.findings.some((finding) => finding.code === "policy-unbounded-traversal"));
    assert.ok(policy.findings.some((finding) => finding.code === "policy-high-estimated-rows"));
    assert.ok(policy.findings.some((finding) => finding.code === "policy-high-cardinality-label-scan"));
    assert.ok(policy.findings.some((finding) => finding.code === "policy-high-fanout-relationship"));
    assert.ok(policy.findings.some((finding) => finding.code === "policy-sensitive-label-access"));
    assert.ok(policy.findings.some((finding) => finding.code === "policy-sensitive-relationship-access"));
    assert.ok(policy.findings.some((finding) => finding.code === "policy-missing-tenant-scope"));

    const policyProfiles = (await executeCypherCompilerTool("cypher_policy_profiles", {})) as {
      version: string;
      profiles: { id: string }[];
    };

    assert.equal(policyProfiles.version, "cypher-llm-policy-profile-catalog/v1");
    assert.ok(policyProfiles.profiles.some((profile) => profile.id === "llm-readonly-strict"));

    const lsp = (await executeCypherCompilerTool("cypher_lsp_diagnostics", {
      schema,
      query: repairableQuery,
      defaultLimit: 25,
      defaultMaxHops: 3,
      parserMode: "syntax"
    })) as { version: string; codeActions: { title: string }[] };

    assert.equal(lsp.version, "cypher-llm-lsp-diagnostics/v1");
    assert.ok(lsp.codeActions.some((action) => action.title.includes("bound-path")));

    const proof = (await executeCypherCompilerTool("cypher_prove", {
      schema,
      query: repairableQuery,
      defaultLimit: 25,
      defaultMaxHops: 3,
      parserMode: "syntax",
      policyRules: {
        version: "cypher-llm-policy-rules/v1",
        id: "proof-tool-policy",
        sensitiveLabels: [{ label: "Hash", severity: "warning" }]
      }
    })) as { status: string; canExecute: boolean; diagnosticCodes: string[]; policyEvidence: { findingCodes: string[] }; claims: { id: string }[] };

    assert.equal(proof.status, "repaired");
    assert.equal(proof.canExecute, true);
    assert.ok(proof.diagnosticCodes.includes("policy-sensitive-label-access"));
    assert.ok(proof.policyEvidence.findingCodes.includes("policy-sensitive-label-access"));
    assert.ok(proof.claims.some((claim) => claim.id === "parser-preflight"));

    const feedback = (await executeCypherCompilerTool("cypher_agent_feedback", {
      schema,
      query: repairableQuery,
      defaultLimit: 25,
      defaultMaxHops: 3
    })) as { status: string; nextAction: { kind: string }; proof: { version: string }; repairPlan: { version: string } };

    assert.equal(feedback.status, "repaired");
    assert.equal(feedback.nextAction.kind, "apply-deterministic-repairs");
    assert.equal(feedback.proof.version, "cypher-llm-proof/v1");
    assert.equal(feedback.repairPlan.version, "cypher-llm-repair-plan/v1");

    const evalReport = (await executeCypherCompilerTool("cypher_eval", {
      dataset: {
        version: "cypher-llm-eval-dataset/v1",
        name: "tool-dispatch",
        tasks: [{ id: "one", question: "Return hash.", schema, expected: { canExecute: true } }]
      },
      attempts: {
        version: "cypher-llm-eval-attempts/v1",
        attempts: [{ taskId: "one", query: repairableQuery }]
      },
      defaultLimit: 25,
      defaultMaxHops: 3
    })) as { version: string };
    const scorecard = (await executeCypherCompilerTool("cypher_scorecard", {
      reports: [evalReport],
      name: "tool-dispatch-scorecard"
    })) as { version: string; lanes: { id: string }[] };
    const gate = (await executeCypherCompilerTool("cypher_benchmark_gate", {
      baseline: evalReport,
      candidate: evalReport,
      minPassRate: 1
    })) as { version: string; status: string };

    assert.equal(scorecard.version, "cypher-llm-cypherbench-scorecard/v1");
    assert.equal(scorecard.lanes[0]?.id, "1-tool-dispatch");
    assert.equal(gate.version, "cypher-llm-benchmark-gate/v1");
    assert.equal(gate.status, "passed");

    const governance = (await executeCypherCompilerTool("cypher_dataset_governance", {
      dataset: {
        version: "cypher-llm-eval-dataset/v1",
        name: "tool-dispatch",
        tasks: [{ id: "one", question: "Return hash.", source: "repo smoke fixture", tags: ["split:smoke"], schema }]
      }
    })) as { version: string; ok: boolean };

    assert.equal(governance.version, "cypher-llm-dataset-governance/v1");
    assert.equal(governance.ok, true);
  });
});

describe("MCP stdio server contract", () => {
  it("lists and calls compiler tools using MCP JSON-RPC shapes", async () => {
    const listed = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    assert.equal(listed?.jsonrpc, "2.0");
    assert.equal((listed?.result as { tools: { name: string }[] }).tools[0]?.name, "cypher_render");

    const called = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "cypher_repair",
        arguments: {
          schema,
          rawCypher: "MATCH (tool:Tool)-[:has MD5 hash]->(hash:Hash) RETURN hash.value"
        }
      }
    });
    const content = (called?.result as { content: { text: string }[] }).content[0]?.text ?? "{}";
    const repaired = JSON.parse(content) as { cypher: string };

    assert.equal(repaired.cypher, "MATCH (tool:Tool)-[:`has MD5 hash`]->(hash:Hash) RETURN hash.value");
  });
});

describe("LangChain adapter", () => {
  it("uses IR repair and parser-backed validation for structured generation", async () => {
    const adapter = createLangChainCypherAdapter(schema, { defaultLimit: 25, defaultMaxHops: 3, parserMode: "syntax" });
    const result = await adapter.compileQuery(repairableQuery);

    assert.equal(result.source, "ir");
    assert.equal(result.canExecute, true);
    assert.equal(result.parserOk, true);
    assert.equal(result.cypher, "MATCH (tool:`Tool`)-[:`has MD5 hash`*1..3]->(hash:`Hash`)\nRETURN hash\nLIMIT 25");
  });

  it("keeps a raw text2cypher migration path without regex relationship rewrites", async () => {
    const adapter = createLangChainCypherAdapter(schema, { parserMode: "syntax" });
    const tool = adapter.asTool();
    const result = await tool.invoke({
      rawCypher: "MATCH (tool:Tool)-[:has MD5 hash]->(hash:Hash) RETURN hash.value"
    });

    assert.equal(result.source, "raw");
    assert.equal(result.parserOk, true);
    assert.equal(result.cypher, "MATCH (tool:Tool)-[:`has MD5 hash`]->(hash:Hash) RETURN hash.value");
  });
});
