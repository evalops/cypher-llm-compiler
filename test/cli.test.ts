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

  it("builds CypherBench scorecards from eval reports", async () => {
    const report = {
      version: "cypher-llm-eval-report/v1",
      datasetName: "cli-scorecard",
      metrics: {
        totalTasks: 1,
        attemptedTasks: 1,
        missingAttempts: 0,
        passedTasks: 1,
        failedTasks: 0,
        irAttempts: 1,
        rawAttempts: 0,
        noCypherAttempts: 0,
        timeoutAttempts: 0,
        executablePlans: 1,
        repairApplied: 0,
        expectedCypherMatches: 1,
        expectedDiagnosticMatches: 0,
        observedSyntaxErrors: 0,
        observedTimeouts: 0,
        observedNoCypher: 0,
        observedReturnsResults: 0,
        expectedAnswerTasks: 0,
        diagnosticsByCode: {},
        passRate: 1,
        executableRate: 1,
        repairRate: 0
      },
      results: []
    };
    const files = new Map<string, string>([
      ["report-a.json", JSON.stringify(report)],
      ["report-b.json", JSON.stringify({ ...report, model: "candidate" })]
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
        "scorecard",
        "--reports",
        "report-a.json,report-b.json",
        "--name",
        "cli-scorecard",
        "--scorecard-out",
        "out/scorecard.json",
        "--markdown-out",
        "out/scorecard.md"
      ],
      io
    );

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.includes("cypher-llm-cypherbench-scorecard/v1"));
    assert.ok(writes.get("out/scorecard.json")?.includes("cli-scorecard"));
    assert.ok(writes.get("out/scorecard.md")?.includes("# cli-scorecard"));
  });

  it("audits dataset governance from dataset files", async () => {
    const dataset = {
      version: "cypher-llm-eval-dataset/v1",
      name: "cli-governance",
      tasks: [
        {
          id: "one",
          question: "Return one.",
          source: "repo smoke fixture",
          tags: ["split:smoke"],
          schema: { version: "cypher-llm-schema/v1", nodes: [], relationships: [] }
        }
      ]
    };
    const files = new Map<string, string>([["dataset.json", JSON.stringify(dataset)]]);
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
      ["dataset-governance", "--dataset", "dataset.json", "--report-out", "out/governance.json", "--fail-on-error"],
      io
    );
    const output = JSON.parse(stdout) as { version: string; ok: boolean };

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.equal(output.version, "cypher-llm-dataset-governance/v1");
    assert.equal(output.ok, true);
    assert.ok(writes.get("out/governance.json")?.includes("default-public-benchmark"));
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

  it("emits lossless parse reports from raw Cypher", async () => {
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
        "parse-lossless",
        "--schema",
        "schema.json",
        "--cypher",
        "// model\nMATCH (tool:Tool) RETURN tool",
        "--report-out",
        "out/lossless.json"
      ],
      io
    );
    const output = JSON.parse(stdout) as { version: string; roundTrip: { ok: boolean }; trivia: { kind: string }[] };

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.equal(output.version, "cypher-llm-lossless-parse/v1");
    assert.equal(output.roundTrip.ok, true);
    assert.equal(output.trivia[0]?.kind, "line-comment");
    assert.ok(writes.get("out/lossless.json")?.includes("cypher-llm-lossless-parse/v1"));
  });

  it("emits proof-carrying compile output", async () => {
    const files = new Map<string, string>([
      [
        "schema.json",
        JSON.stringify({
          version: "cypher-llm-schema/v1",
          dialect: "neo4j-cypher-25",
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
      ["prove", "--schema", "schema.json", "--query", "query.json", "--proof-out", "out/proof.json", "--default-limit", "25"],
      io
    );

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.includes("cypher-llm-proof/v1"));
    assert.ok(writes.get("out/proof.json")?.includes("parser-preflight"));
  });

  it("emits cost and safety policy reports", async () => {
    const files = new Map<string, string>([
      [
        "schema.json",
        JSON.stringify({
          version: "cypher-llm-schema/v1",
          dialect: "neo4j-cypher-25",
          nodes: [{ name: "Tool" }],
          relationships: []
        })
      ],
      [
        "query.json",
        JSON.stringify({
          version: "cypher-llm-ir/v1",
          clauses: [
            { kind: "match", patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }] },
            { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }] }
          ]
        })
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

    const code = await runCli(["policy-check", "--schema", "schema.json", "--query", "query.json", "--report-out", "out/policy.json"], io);

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.includes("cypher-llm-policy-report/v1"));
    assert.ok(writes.get("out/policy.json")?.includes("policy-unfiltered-label-scan"));
  });

  it("emits LSP diagnostics and code actions", async () => {
    const files = new Map<string, string>([
      [
        "schema.json",
        JSON.stringify({
          version: "cypher-llm-schema/v1",
          nodes: [{ name: "Tool" }],
          relationships: []
        })
      ],
      [
        "query.json",
        JSON.stringify({
          version: "cypher-llm-ir/v1",
          clauses: [
            { kind: "match", patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }] },
            { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }] }
          ]
        })
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

    const code = await runCli(["lsp-diagnostics", "--schema", "schema.json", "--query", "query.json", "--report-out", "out/lsp.json"], io);

    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.includes("cypher-llm-lsp-diagnostics/v1"));
    assert.ok(writes.get("out/lsp.json")?.includes("Add a bounded LIMIT"));
  });

  it("lifts raw Cypher and evaluates raw-lift attempts", async () => {
    const schema = {
      version: "cypher-llm-schema/v1",
      nodes: [{ name: "Tool" }],
      relationships: []
    };
    const dataset = {
      version: "cypher-llm-eval-dataset/v1",
      name: "lift-cli",
      tasks: [{ id: "one", question: "Return tools.", schema }]
    };
    const attempts = {
      version: "cypher-llm-eval-attempts/v1",
      attempts: [{ taskId: "one", rawCypher: "MATCH (tool:Tool) RETURN tool LIMIT 1" }]
    };
    const files = new Map<string, string>([
      ["schema.json", JSON.stringify(schema)],
      ["dataset.json", JSON.stringify(dataset)],
      ["attempts.json", JSON.stringify(attempts)]
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

    const liftCode = await runCli(
      [
        "lift-raw",
        "--schema",
        "schema.json",
        "--cypher",
        "MATCH (tool:Tool) RETURN tool LIMIT 1",
        "--query-out",
        "out/query.json"
      ],
      io
    );
    const evalCode = await runCli(
      ["lift-raw-eval", "--dataset", "dataset.json", "--attempts", "attempts.json", "--summary-out", "out/lift.json"],
      io
    );

    assert.equal(liftCode, 0);
    assert.equal(evalCode, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.includes("cypher-llm-raw-lift/v1"));
    assert.ok(stdout.includes("cypher-llm-raw-lift-eval/v1"));
    assert.ok(writes.has("out/query.json"));
    assert.ok(writes.has("out/lift.json"));
  });

  it("prints and writes the years-scale roadmap", async () => {
    const writes = new Map<string, string>();
    let stdout = "";
    let stderr = "";
    const io: CliIO = {
      stdout: { write: (chunk: string | Uint8Array) => ((stdout += String(chunk)), true) },
      stderr: { write: (chunk: string | Uint8Array) => ((stderr += String(chunk)), true) },
      readFile: async () => "",
      writeFile: async (path, data) => {
        writes.set(path, data);
      },
      mkdir: async () => undefined
    };

    const jsonCode = await runCli(["roadmap", "--integrity", "--roadmap-out", "out/roadmap.json"], io);
    const markdownCode = await runCli(["roadmap", "--format", "markdown"], io);

    assert.equal(jsonCode, 0);
    assert.equal(markdownCode, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.includes("cypher-llm-years-roadmap/v1"));
    assert.ok(stdout.includes("# Years-Scale Roadmap"));
    assert.ok(writes.get("out/roadmap.json")?.includes("cypher-llm-roadmap-integrity/v1"));
  });

  it("prints and writes the dialect certification report", async () => {
    const writes = new Map<string, string>();
    let stdout = "";
    let stderr = "";
    const io: CliIO = {
      stdout: { write: (chunk: string | Uint8Array) => ((stdout += String(chunk)), true) },
      stderr: { write: (chunk: string | Uint8Array) => ((stderr += String(chunk)), true) },
      readFile: async () => "",
      writeFile: async (path, data) => {
        writes.set(path, data);
      },
      mkdir: async () => undefined
    };

    const jsonCode = await runCli(["certify-dialects", "--fail-on-fail", "--report-out", "out/certification.json"], io);
    const markdownCode = await runCli(["certify-dialects", "--format", "markdown"], io);

    assert.equal(jsonCode, 0);
    assert.equal(markdownCode, 0);
    assert.equal(stderr, "");
    assert.ok(stdout.includes("cypher-llm-dialect-certification/v1"));
    assert.ok(stdout.includes("# Dialect Certification"));
    assert.ok(writes.get("out/certification.json")?.includes("\"failedChecks\": 0"));
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
