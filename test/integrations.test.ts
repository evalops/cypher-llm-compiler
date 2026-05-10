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

    assert.deepEqual(names, ["cypher_render", "cypher_validate", "cypher_repair", "cypher_parse_check", "cypher_eval"]);
    assert.equal(chatTools[0]?.function.name, "cypher_render");
    assert.equal(responseTools.every((tool) => tool.type === "function" && tool.parameters.type === "object"), true);
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
