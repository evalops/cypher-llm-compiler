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

  it("runs the eval harness from dataset and attempts files", async () => {
    const files = new Map<string, string>([
      [
        "dataset.json",
        JSON.stringify({
          version: "cypher-llm-eval-dataset/v1",
          name: "cli-smoke",
          tasks: [
            {
              id: "one",
              question: "Return one.",
              schema: {
                version: "cypher-llm-schema/v1",
                nodes: [],
                relationships: []
              },
              expected: {
                cypherContains: ["RETURN 1"],
                canExecute: true
              }
            }
          ]
        })
      ],
      [
        "attempts.json",
        JSON.stringify({
          version: "cypher-llm-eval-attempts/v1",
          attempts: [
            {
              taskId: "one",
              query: {
                version: "cypher-llm-ir/v1",
                profile: "llm-safe-readonly",
                clauses: [
                  {
                    kind: "return",
                    items: [{ expression: { kind: "literal", value: 1 } }]
                  }
                ]
              }
            }
          ]
        })
      ]
    ]);
    let stdout = "";
    let stderr = "";
    const writes = new Map<string, string>();
    const io: CliIO = {
      stdout: { write: (chunk: string | Uint8Array) => ((stdout += String(chunk)), true) },
      stderr: { write: (chunk: string | Uint8Array) => ((stderr += String(chunk)), true) },
      readFile: async (path) => files.get(String(path)) ?? "",
      writeFile: async (path, data) => {
        writes.set(path, data);
      },
      mkdir: async () => undefined
    };

    const code = await runCli(
      [
        "eval",
        "--dataset",
        "dataset.json",
        "--attempts",
        "attempts.json",
        "--report-out",
        "out/report.json",
        "--raw-cypher-can-execute",
        "--default-limit",
        "10"
      ],
      io
    );
    const output = JSON.parse(stdout) as { metrics: { passedTasks: number; passRate: number } };

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.equal(output.metrics.passedTasks, 1);
    assert.equal(output.metrics.passRate, 1);
    assert.ok(writes.has("out/report.json"));
  });

  it("compares eval reports and writes repair-loop feedback", async () => {
    const dataset = {
      version: "cypher-llm-eval-dataset/v1",
      name: "cli-compare",
      tasks: [
        {
          id: "one",
          question: "Return one.",
          schema: { version: "cypher-llm-schema/v1", nodes: [], relationships: [] },
          expected: { cypherContains: ["RETURN 1"], canExecute: true }
        }
      ]
    };
    const attempts = {
      version: "cypher-llm-eval-attempts/v1",
      attempts: [
        {
          taskId: "one",
          query: {
            version: "cypher-llm-ir/v1",
            profile: "llm-safe-readonly",
            clauses: [{ kind: "return", items: [{ expression: { kind: "literal", value: 1 } }] }]
          }
        }
      ]
    };
    const baselineReport = {
      version: "cypher-llm-eval-report/v1",
      datasetName: "cli-compare",
      metrics: {
        totalTasks: 1,
        attemptedTasks: 1,
        missingAttempts: 0,
        passedTasks: 0,
        failedTasks: 1,
        irAttempts: 0,
        rawAttempts: 1,
        noCypherAttempts: 0,
        timeoutAttempts: 0,
        executablePlans: 0,
        repairApplied: 0,
        expectedCypherMatches: 0,
        expectedDiagnosticMatches: 0,
        observedSyntaxErrors: 0,
        observedTimeouts: 0,
        observedNoCypher: 0,
        observedReturnsResults: 0,
        expectedAnswerTasks: 0,
        diagnosticsByCode: { "no-cypher-output": 1 },
        passRate: 0,
        executableRate: 0,
        repairRate: 0
      },
      results: []
    };
    const candidateReport = {
      ...baselineReport,
      metrics: {
        ...baselineReport.metrics,
        passedTasks: 1,
        failedTasks: 0,
        executablePlans: 1,
        diagnosticsByCode: {},
        passRate: 1,
        executableRate: 1
      }
    };
    const files = new Map<string, string>([
      ["dataset.json", JSON.stringify(dataset)],
      ["attempts.json", JSON.stringify(attempts)],
      ["baseline.json", JSON.stringify(baselineReport)],
      ["candidate.json", JSON.stringify(candidateReport)]
    ]);
    const writes = new Map<string, string>();
    let stdout = "";
    let stderr = "";
    const io: CliIO = {
      stdout: { write: (chunk: string | Uint8Array) => ((stdout += String(chunk)), true) },
      stderr: { write: (chunk: string | Uint8Array) => ((stderr += String(chunk)), true) },
      readFile: async (path) => files.get(String(path)) ?? "",
      writeFile: async (path, data) => {
        writes.set(path, data);
      },
      mkdir: async () => undefined
    };

    const compareCode = await runCli(
      ["compare-evals", "--baseline", "baseline.json", "--candidate", "candidate.json", "--comparison-out", "out/comparison.json"],
      io
    );
    const repairCode = await runCli(
      ["repair-loop", "--dataset", "dataset.json", "--attempts", "attempts.json", "--feedback-out", "out/feedback.json", "--default-limit", "10"],
      io
    );

    assert.equal(compareCode, 0);
    assert.equal(repairCode, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.includes("cypher-llm-eval-comparison/v1"));
    assert.ok(stdout.includes("cypher-llm-repair-loop/v1"));
    assert.ok(writes.has("out/comparison.json"));
    assert.ok(writes.has("out/feedback.json"));
  });

  it("runs parser-backed validation from raw Cypher", async () => {
    const files = new Map<string, string>([
      [
        "schema.json",
        JSON.stringify({
          version: "cypher-llm-schema/v1",
          nodes: [{ name: "Tool" }],
          relationships: []
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

    const code = await runCli(["parse-check", "--schema", "schema.json", "--cypher", "MATCH (tool:`Tool`) RETURN tool"], io);
    const output = JSON.parse(stdout) as { ok: boolean; diagnostics: unknown[] };

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.equal(output.ok, true);
    assert.deepEqual(output.diagnostics, []);
  });

  it("imports text2cypher CSV fixtures to dataset and attempt files", async () => {
    const files = new Map<string, string>([
      [
        "rows.csv",
        [
          "question,cypher,type,database,explanation,syntax_error,timeout,returns_results,no_cypher",
          '"Find users","MATCH (u:User) RETURN u",Simple,graph,"",False,False,True,False'
        ].join("\n")
      ]
    ]);
    const writes = new Map<string, string>();
    let stdout = "";
    let stderr = "";
    const io: CliIO = {
      stdout: { write: (chunk: string | Uint8Array) => ((stdout += String(chunk)), true) },
      stderr: { write: (chunk: string | Uint8Array) => ((stderr += String(chunk)), true) },
      readFile: async (path) => files.get(String(path)) ?? "",
      writeFile: async (path, data) => {
        writes.set(path, data);
      },
      mkdir: async () => undefined
    };

    const code = await runCli(
      [
        "import-text2cypher",
        "--csv",
        "rows.csv",
        "--dataset-out",
        "out/dataset.json",
        "--attempts-out",
        "out/attempts.json",
        "--summary-out",
        "out/summary.json",
        "--dataset-name",
        "cli-import"
      ],
      io
    );
    const summary = JSON.parse(stdout) as { importedRows: number; returnsResultsRows: number };

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.equal(summary.importedRows, 1);
    assert.equal(summary.returnsResultsRows, 1);
    assert.ok(writes.has("out/dataset.json"));
    assert.ok(writes.has("out/attempts.json"));
    assert.ok(writes.has("out/summary.json"));
  });
});
