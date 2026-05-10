export type RoadmapStatus = "implemented" | "partial" | "planned";
export type WorkstreamStatus = "seeded" | "active" | "planned";

export interface RoadmapIssue {
  number: number;
  url: string;
}

export interface RoadmapCapability {
  id: string;
  title: string;
  status: RoadmapStatus;
  evidence: string[];
  workstreamIds: string[];
}

export interface RoadmapWorkstream {
  id: string;
  title: string;
  horizon: "years";
  status: WorkstreamStatus;
  issue: RoadmapIssue;
  thesis: string;
  outcomes: string[];
  firstArtifacts: string[];
  acceptanceGates: string[];
  dependencies?: string[];
}

export interface YearsRoadmap {
  version: "cypher-llm-years-roadmap/v1";
  generatedAt: string;
  thesis: string;
  workstreams: RoadmapWorkstream[];
  capabilities: RoadmapCapability[];
}

export interface RoadmapIntegrityReport {
  version: "cypher-llm-roadmap-integrity/v1";
  ok: boolean;
  workstreams: number;
  capabilities: number;
  plannedCapabilities: number;
  partialCapabilities: number;
  implementedCapabilities: number;
  diagnostics: string[];
}

export const yearsRoadmap = {
  version: "cypher-llm-years-roadmap/v1",
  generatedAt: "2026-05-10",
  thesis:
    "Make Cypher safe and productive for long-running LLM agents by turning string generation into a compiler, conformance, benchmark, service, and governance program.",
  workstreams: [
    {
      id: "lossless-parser-ast",
      title: "Lossless Cypher Parser And AST Round Trip",
      horizon: "years",
      status: "seeded",
      issue: {
        number: 10,
        url: "https://github.com/evalops/cypher-llm-compiler/issues/10"
      },
      thesis:
        "A real LLM compiler must ingest existing Cypher, preserve unsupported syntax, and repair exact subtrees without semantic drift.",
      outcomes: [
        "Grammar-faithful parsing for representative Neo4j Cypher 25, openCypher 9, and GQL-oriented syntax.",
        "Source spans, comments, raw spans, and unsupported constructs survive migration.",
        "Raw Cypher, lifted IR, rendered Cypher, and parser diagnostics can be compared in one loop."
      ],
      firstArtifacts: [
        "src/lossless-parser.ts",
        "src/raw-lift.ts",
        "docs/LOSSLESS_PARSE.md",
        "docs/RAW_LIFT.md",
        "examples/lossless/tool-hash.lossless.json",
        "examples/benchmarks/tool-hash-lifted.summary.json"
      ],
      acceptanceGates: [
        "Round-trip fixtures preserve source meaning and unsupported spans.",
        "Parser diagnostics point to both source spans and IR JSON pointers.",
        "Conformance fixtures cover common real-world Cypher beyond the current raw-lift subset."
      ]
    },
    {
      id: "dialect-certification",
      title: "Dialect Certification",
      horizon: "years",
      status: "seeded",
      issue: {
        number: 11,
        url: "https://github.com/evalops/cypher-llm-compiler/issues/11"
      },
      thesis:
        "LLM clients should know exactly which Cypher dialect claims are enforced by parser, renderer, semantic, and live database evidence.",
      outcomes: [
        "Executable compatibility reports for Neo4j Cypher 25, openCypher 9, and GQL-oriented profiles.",
        "Profile claims become CI-gated capabilities, not prose.",
        "Known dialect limitations are visible before an agent emits a query."
      ],
      firstArtifacts: [
        "profiles/neo4j-cypher-25.json",
        "profiles/opencypher-9.json",
        "profiles/gql.json",
        "src/dialect-certification.ts",
        "test/dialects.test.ts"
      ],
      acceptanceGates: [
        "Every stable profile claim has a passing fixture.",
        "Preview and experimental claims report unsupported or rendering-limitation diagnostics.",
        "Certification reports separate parser, renderer, semantic, and live-database results."
      ],
      dependencies: ["lossless-parser-ast"]
    },
    {
      id: "public-cypherbench",
      title: "Public CypherBench Program",
      horizon: "years",
      status: "seeded",
      issue: {
        number: 12,
        url: "https://github.com/evalops/cypher-llm-compiler/issues/12"
      },
      thesis:
        "Cypher quality for LLMs should move by measured benchmark deltas across raw, lifted, IR-first, repaired, parser-validated, and live-executed lanes.",
      outcomes: [
        "Curated datasets with provenance, redaction, splits, and regression gates.",
        "Model and compiler scorecards that make retries and repairs comparable.",
        "Benchmark reports that can be published from CI."
      ],
      firstArtifacts: ["src/evals.ts", "src/eval-compare.ts", "src/repair-loop.ts", "docs/CYPHERBENCH.md"],
      acceptanceGates: [
        "Scorecards include syntax, semantic, dialect, safety, and live execution metrics.",
        "CI can fail on benchmark regressions for stable lanes.",
        "Dataset governance is documented and machine-readable."
      ],
      dependencies: ["dialect-certification"]
    },
    {
      id: "semantic-proof-repair",
      title: "Semantic Proof And Repair Planning",
      horizon: "years",
      status: "seeded",
      issue: {
        number: 13,
        url: "https://github.com/evalops/cypher-llm-compiler/issues/13"
      },
      thesis:
        "Agents need proof objects and ranked repair plans, not just diagnostics, so retries converge and accepted queries explain why they are safe.",
      outcomes: [
        "Proof objects for scope, types, dialect compatibility, safety, and execution preflight.",
        "Minimal IR patches split into deterministic, model-required, and unsafe repair classes.",
        "Repair plans attach source spans, IR paths, and benchmark evidence."
      ],
      firstArtifacts: ["src/validate.ts", "src/repair.ts", "src/proof.ts", "src/failure-corpus.ts", "docs/FAILURE_CORPUS.md"],
      acceptanceGates: [
        "Every accepted query can emit a compact proof summary.",
        "Every failed query can emit a bounded repair plan or a clear refusal.",
        "Repair plans are benchmarked against repeated model retry attempts."
      ],
      dependencies: ["lossless-parser-ast", "public-cypherbench"]
    },
    {
      id: "compiler-service",
      title: "Compiler Service For Agent Runtimes",
      horizon: "years",
      status: "seeded",
      issue: {
        number: 14,
        url: "https://github.com/evalops/cypher-llm-compiler/issues/14"
      },
      thesis:
        "A shared service turns the compiler from a library into production infrastructure for agents and graph apps.",
      outcomes: [
        "HTTP, MCP, and worker-compatible APIs for compile, validate, repair, introspect, preflight, benchmark, and explain operations.",
        "Tenant/schema isolation, redaction, audit logs, and observability.",
        "Versioned service contracts and deployment guidance."
      ],
      firstArtifacts: ["src/tools.ts", "src/mcp-server.ts", "src/http-server.ts", "src/cli.ts", "docs/INTEGRATIONS.md"],
      acceptanceGates: [
        "Service contracts are schema-validated and backwards compatible.",
        "Operational metrics cover diagnostics, repairs, retries, and live database outcomes.",
        "Auth, redaction, and tenant boundaries are testable."
      ],
      dependencies: ["semantic-proof-repair"]
    },
    {
      id: "cost-safety-policy",
      title: "Cost, Cardinality, And Safety Policy Planning",
      horizon: "years",
      status: "seeded",
      issue: {
        number: 15,
        url: "https://github.com/evalops/cypher-llm-compiler/issues/15"
      },
      thesis:
        "A query can be syntactically valid and still be too expensive, broad, or unsafe for an autonomous agent to run.",
      outcomes: [
        "Traversal fanout, cardinality, missing-predicate, and write-risk diagnostics.",
        "Policy DSL for approvals, tenant restrictions, and sensitive data boundaries.",
        "Integration with schema statistics and live planner estimates."
      ],
      firstArtifacts: ["src/safety.ts", "src/policy.ts", "src/neo4j-explain.ts", "docs/LLM_SAFE_PROFILE.md"],
      acceptanceGates: [
        "Risky but syntactically valid queries are caught before execution.",
        "Safety diagnostics feed proof objects and repair plans.",
        "Policy decisions are auditable and benchmarked."
      ],
      dependencies: ["compiler-service"]
    },
    {
      id: "ecosystem-ux",
      title: "Ecosystem UX",
      horizon: "years",
      status: "seeded",
      issue: {
        number: 16,
        url: "https://github.com/evalops/cypher-llm-compiler/issues/16"
      },
      thesis:
        "The compiler must meet humans and agents in their actual authoring surfaces: IDEs, MCP clients, notebooks, CI, and benchmark dashboards.",
      outcomes: [
        "LSP-compatible diagnostics and code actions backed by compiler repairs.",
        "Interactive raw-to-IR migration and schema-contract tooling.",
        "Report rendering for CI, docs, and agent feedback UX."
      ],
      firstArtifacts: ["src/tools.ts", "src/lsp.ts", "docs/INTEGRATIONS.md", "examples/raw-to-ir-migration.md"],
      acceptanceGates: [
        "Editor and MCP clients receive the same stable diagnostic contract.",
        "Migration UX exposes source spans, IR paths, and repair previews.",
        "Report rendering is covered by tests and visual fixtures where relevant."
      ],
      dependencies: ["semantic-proof-repair", "public-cypherbench"]
    },
    {
      id: "governance-standards",
      title: "Release, Standards, And Compatibility Governance",
      horizon: "years",
      status: "active",
      issue: {
        number: 17,
        url: "https://github.com/evalops/cypher-llm-compiler/issues/17"
      },
      thesis:
        "An LLM-facing compiler becomes infrastructure, so public promises need versioned governance and CI-backed capability metadata.",
      outcomes: [
        "RFCs, compatibility levels, release checklists, and certification checklists.",
        "Machine-readable roadmap and capability status.",
        "CI validation for roadmap and capability metadata."
      ],
      firstArtifacts: ["docs/COMPATIBILITY.md", "CHANGELOG.md", "schemas/years-roadmap.schema.json"],
      acceptanceGates: [
        "Every public workstream links to a GitHub issue.",
        "Roadmap JSON validates against schema.",
        "Capabilities have evidence paths and status."
      ]
    }
  ],
  capabilities: [
    {
      id: "json-ir",
      title: "Structured CypherQuery IR",
      status: "implemented",
      evidence: ["src/ir.ts", "schemas/cypher-query.schema.json", "test/render.test.ts"],
      workstreamIds: ["semantic-proof-repair", "lossless-parser-ast"]
    },
    {
      id: "schema-contract",
      title: "Typed CypherSchemaContract",
      status: "implemented",
      evidence: ["src/ir.ts", "src/schema.ts", "schemas/cypher-schema-contract.schema.json"],
      workstreamIds: ["semantic-proof-repair", "cost-safety-policy"]
    },
    {
      id: "raw-lift",
      title: "Raw Cypher To IR Migration Bridge",
      status: "partial",
      evidence: ["src/raw-lift.ts", "docs/RAW_LIFT.md", "test/raw-lift.test.ts"],
      workstreamIds: ["lossless-parser-ast"]
    },
    {
      id: "lossless-parse",
      title: "Lossless Source Round Trip And Clause CST",
      status: "partial",
      evidence: ["src/lossless-parser.ts", "schemas/lossless-parse.schema.json", "test/lossless-parser.test.ts"],
      workstreamIds: ["lossless-parser-ast", "ecosystem-ux"]
    },
    {
      id: "dialect-profiles",
      title: "Dialect Profiles And Validation",
      status: "partial",
      evidence: ["src/dialects.ts", "src/dialect-certification.ts", "profiles/opencypher-9.json", "test/dialects.test.ts"],
      workstreamIds: ["dialect-certification"]
    },
    {
      id: "cypherbench",
      title: "CypherBench Offline Eval Harness",
      status: "partial",
      evidence: ["src/evals.ts", "src/eval-compare.ts", "docs/CYPHERBENCH.md"],
      workstreamIds: ["public-cypherbench"]
    },
    {
      id: "repair-loop",
      title: "Model Retry And Repair Packets",
      status: "partial",
      evidence: ["src/repair-loop.ts", "docs/REPAIR_LOOP.md", "test/eval-compare.test.ts"],
      workstreamIds: ["public-cypherbench", "semantic-proof-repair"]
    },
    {
      id: "parser-validation",
      title: "Parser-Backed Validation",
      status: "partial",
      evidence: ["src/parser-validation.ts", "test/parser-validation.test.ts"],
      workstreamIds: ["lossless-parser-ast", "dialect-certification"]
    },
    {
      id: "live-explain",
      title: "Live Neo4j EXPLAIN Preflight",
      status: "partial",
      evidence: ["src/neo4j-explain.ts", "test/neo4j-live.test.ts", "docs/NEO4J_LIVE_FIXTURE.md"],
      workstreamIds: ["cost-safety-policy", "public-cypherbench"]
    },
    {
      id: "policy-reports",
      title: "Static Cost And Safety Policy Reports",
      status: "partial",
      evidence: ["src/policy.ts", "schemas/policy-report.schema.json", "test/policy.test.ts"],
      workstreamIds: ["cost-safety-policy", "semantic-proof-repair"]
    },
    {
      id: "compiler-service",
      title: "Long-Running Compiler Service",
      status: "partial",
      evidence: ["src/tools.ts", "src/mcp-server.ts", "src/http-server.ts", "test/http-server.test.ts", "docs/INTEGRATIONS.md"],
      workstreamIds: ["compiler-service", "ecosystem-ux"]
    },
    {
      id: "lsp-diagnostics",
      title: "LSP-Style Diagnostics And Code Actions",
      status: "partial",
      evidence: ["src/lsp.ts", "schemas/lsp-diagnostics.schema.json", "test/lsp.test.ts"],
      workstreamIds: ["ecosystem-ux", "semantic-proof-repair"]
    },
    {
      id: "proof-objects",
      title: "Proof-Carrying Validation And Repair Plans",
      status: "partial",
      evidence: ["src/proof.ts", "src/policy.ts", "schemas/cypher-proof.schema.json", "test/proof.test.ts"],
      workstreamIds: ["semantic-proof-repair", "cost-safety-policy"]
    },
    {
      id: "roadmap-governance",
      title: "Machine-Readable Roadmap Governance",
      status: "partial",
      evidence: ["src/years-roadmap.ts", "schemas/years-roadmap.schema.json", "docs/YEARS_ROADMAP.md"],
      workstreamIds: ["governance-standards"]
    }
  ]
} as const satisfies YearsRoadmap;

export function getYearsRoadmap(): YearsRoadmap {
  return JSON.parse(JSON.stringify(yearsRoadmap)) as YearsRoadmap;
}

export function roadmapIntegrityReport(roadmap: YearsRoadmap = yearsRoadmap): RoadmapIntegrityReport {
  const diagnostics: string[] = [];
  const workstreamIds = new Set(roadmap.workstreams.map((workstream) => workstream.id));
  const capabilityIds = new Set<string>();

  for (const workstream of roadmap.workstreams) {
    if (!workstream.issue.url.endsWith(`/issues/${workstream.issue.number}`)) {
      diagnostics.push(`workstream ${workstream.id} issue URL does not match issue number`);
    }
    for (const dependency of workstream.dependencies ?? []) {
      if (!workstreamIds.has(dependency)) {
        diagnostics.push(`workstream ${workstream.id} depends on unknown workstream ${dependency}`);
      }
    }
  }

  for (const capability of roadmap.capabilities) {
    if (capabilityIds.has(capability.id)) {
      diagnostics.push(`duplicate capability ${capability.id}`);
    }
    capabilityIds.add(capability.id);
    if (capability.evidence.length === 0) {
      diagnostics.push(`capability ${capability.id} has no evidence paths`);
    }
    for (const workstreamId of capability.workstreamIds) {
      if (!workstreamIds.has(workstreamId)) {
        diagnostics.push(`capability ${capability.id} references unknown workstream ${workstreamId}`);
      }
    }
  }

  return {
    version: "cypher-llm-roadmap-integrity/v1",
    ok: diagnostics.length === 0,
    workstreams: roadmap.workstreams.length,
    capabilities: roadmap.capabilities.length,
    plannedCapabilities: roadmap.capabilities.filter((capability) => capability.status === "planned").length,
    partialCapabilities: roadmap.capabilities.filter((capability) => capability.status === "partial").length,
    implementedCapabilities: roadmap.capabilities.filter((capability) => capability.status === "implemented").length,
    diagnostics
  };
}

export function renderYearsRoadmapMarkdown(roadmap: YearsRoadmap = yearsRoadmap): string {
  const lines = [
    "# Years-Scale Roadmap",
    "",
    roadmap.thesis,
    "",
    "## Workstreams",
    ""
  ];

  for (const workstream of roadmap.workstreams) {
    lines.push(
      `### ${workstream.title}`,
      "",
      `- Status: ${workstream.status}`,
      `- Issue: #${workstream.issue.number} (${workstream.issue.url})`,
      `- Thesis: ${workstream.thesis}`,
      `- First artifacts: ${workstream.firstArtifacts.join(", ")}`,
      `- Acceptance gates: ${workstream.acceptanceGates.join("; ")}`,
      ""
    );
  }

  lines.push("## Capability Status", "");
  for (const capability of roadmap.capabilities) {
    lines.push(
      `- ${capability.id}: ${capability.status} - ${capability.title}`,
      `  Evidence: ${capability.evidence.join(", ")}`
    );
  }

  return `${lines.join("\n")}\n`;
}
