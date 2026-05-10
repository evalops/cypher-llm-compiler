import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCli, type CliIO } from "../src/cli.js";

describe("cli", () => {
  it("renders an execution plan from schema and query files", async () => {
    const files = new Map<string, string>([
      [
        "schema.json",
        JSON.stringify({
          version: "cypher-llm-schema/v1",
          nodes: [
            { name: "Tool", properties: { name: { type: "STRING" } } },
            { name: "Hash", properties: { value: { type: "STRING" } } }
          ],
          relationships: [{ type: "has MD5 hash", from: "Tool", to: "Hash" }]
        })
      ],
      [
        "query.json",
        JSON.stringify({
          version: "cypher-llm-ir/v1",
          profile: "llm-safe-readonly",
          clauses: [
            {
              kind: "match",
              patterns: [
                {
                  segments: [
                    { variable: "tool", labels: ["Tool"] },
                    { rel: { types: ["has MD5 hash"], direction: "out" }, node: { variable: "hash", labels: ["Hash"] } }
                  ]
                }
              ]
            },
            { kind: "return", items: [{ expression: { kind: "var", name: "hash" } }] }
          ]
        })
      ]
    ]);
    let stdout = "";
    let stderr = "";
    const io: CliIO = {
      stdout: { write: (chunk: string | Uint8Array) => ((stdout += String(chunk)), true) },
      stderr: { write: (chunk: string | Uint8Array) => ((stderr += String(chunk)), true) },
      readFile: async (path) => files.get(String(path)) ?? ""
    };

    const code = await runCli(["render", "--schema", "schema.json", "--query", "query.json", "--default-limit", "10"], io);
    const output = JSON.parse(stdout) as { cypher: string; canExecute: boolean };

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.equal(output.cypher, "MATCH (tool:`Tool`)-[:`has MD5 hash`]->(hash:`Hash`)\nRETURN hash\nLIMIT 10");
    assert.equal(output.canExecute, true);
  });
});
