export type CompatibilityLevel = "stable" | "preview" | "experimental";

export type CompatibilityCategory =
  | "agent-feedback"
  | "benchmark"
  | "diagnostic"
  | "dialect"
  | "eval"
  | "governance"
  | "integration"
  | "ir"
  | "policy"
  | "proof"
  | "repair"
  | "schema"
  | "service";

export interface CompatibilityLevelDefinition {
  level: CompatibilityLevel;
  title: string;
  changePolicy: string;
  consumerGuidance: string;
}

export interface CompatibilityContract {
  id: string;
  version: string;
  category: CompatibilityCategory;
  level: CompatibilityLevel;
  ownerWorkstreamId: string;
  schemaPath?: string;
  examplePaths: string[];
  evidencePaths: string[];
  breakingChangePolicy: string;
  deprecationPolicy: string;
}

export interface CompatibilityGate {
  id: string;
  title: string;
  command: string;
  evidencePaths: string[];
}

export interface CompatibilityCatalog {
  version: "cypher-llm-compatibility-catalog/v1";
  generatedAt: string;
  packageName: "@evalops/cypher-llm-compiler";
  packageVersion: string;
  levels: CompatibilityLevelDefinition[];
  contracts: CompatibilityContract[];
  releaseGates: CompatibilityGate[];
  certificationGates: CompatibilityGate[];
  deprecationPolicy: {
    minimumNotice: string;
    requiresMigrationNote: boolean;
    requiresReplacementContract: boolean;
    appliesToLevels: CompatibilityLevel[];
  };
}

export interface CompatibilityIntegrityReport {
  version: "cypher-llm-compatibility-integrity/v1";
  ok: boolean;
  contracts: number;
  stableContracts: number;
  previewContracts: number;
  experimentalContracts: number;
  diagnostics: string[];
}

const PACKAGE_VERSION = "0.1.0";

export const compatibilityCatalog = {
  version: "cypher-llm-compatibility-catalog/v1",
  generatedAt: "2026-05-10",
  packageName: "@evalops/cypher-llm-compiler",
  packageVersion: PACKAGE_VERSION,
  levels: [
    {
      level: "stable",
      title: "Stable Contract",
      changePolicy: "No breaking structural changes inside the same contract version.",
      consumerGuidance: "Safe for agent runtimes, CI gates, examples, and integrations to depend on."
    },
    {
      level: "preview",
      title: "Preview Contract",
      changePolicy: "Compatible additions are preferred, but documented reshaping may occur before promotion to stable.",
      consumerGuidance: "Safe for experiments and guarded integrations that pin package versions."
    },
    {
      level: "experimental",
      title: "Experimental Contract",
      changePolicy: "Shape and semantics may change while the workstream is being discovered.",
      consumerGuidance: "Use for fixtures, research, and opt-in trials; do not assume long-lived compatibility."
    }
  ],
  contracts: [
    stableContract("cypher-query-ir", "cypher-llm-ir/v1", "ir", "semantic-proof-repair", "schemas/cypher-query.schema.json", [
      "examples/tool-hash.query.json"
    ], ["src/ir.ts", "src/render.ts", "test/render.test.ts"]),
    stableContract("schema-contract", "cypher-llm-schema/v1", "schema", "semantic-proof-repair", "schemas/cypher-schema-contract.schema.json", [
      "examples/tool-hash.schema.json"
    ], ["src/ir.ts", "src/schema.ts", "test/compiler-loop.test.ts"]),
    stableContract("diagnostic-shape", "cypher-llm-diagnostic/v1", "diagnostic", "ecosystem-ux", undefined, [
      "examples/lsp/tool-hash.lsp.json",
      "examples/proofs/tool-hash.proof.json"
    ], ["src/diagnostics.ts", "src/validate.ts", "docs/COMPATIBILITY.md"]),
    stableContract("eval-dataset", "cypher-llm-eval-dataset/v1", "eval", "public-cypherbench", "schemas/eval-dataset.schema.json", [
      "examples/eval-dataset.json"
    ], ["src/evals.ts", "test/evals.test.ts"]),
    stableContract("eval-attempts", "cypher-llm-eval-attempts/v1", "eval", "public-cypherbench", "schemas/eval-attempts.schema.json", [
      "examples/eval-attempts.json"
    ], ["src/evals.ts", "test/evals.test.ts"]),
    stableContract("dialect-profile", "cypher-llm-dialect-profile/v1", "dialect", "dialect-certification", "schemas/dialect-profile.schema.json", [
      "profiles/neo4j-cypher-25.json",
      "profiles/opencypher-9.json",
      "profiles/gql.json"
    ], ["src/dialects.ts", "test/dialects.test.ts"]),
    stableContract("dialect-certification", "cypher-llm-dialect-certification/v1", "dialect", "dialect-certification", "schemas/dialect-certification.schema.json", [
      "examples/certification/dialect-certification.json"
    ], ["src/dialect-certification.ts", "test/dialect-certification.test.ts"]),
    stableContract("proof", "cypher-llm-proof/v1", "proof", "semantic-proof-repair", "schemas/cypher-proof.schema.json", [
      "examples/proofs/tool-hash.proof.json"
    ], ["src/proof.ts", "test/proof.test.ts"]),
    stableContract("repair-plan", "cypher-llm-repair-plan/v1", "repair", "semantic-proof-repair", "schemas/repair-plan.schema.json", [
      "examples/proofs/tool-hash.repair-plan.json"
    ], ["src/repair-plan.ts", "test/repair-plan.test.ts"]),
    stableContract("agent-feedback", "cypher-llm-agent-feedback/v1", "agent-feedback", "ecosystem-ux", "schemas/agent-feedback.schema.json", [
      "examples/proofs/tool-hash.agent-feedback.json"
    ], ["src/agent-feedback.ts", "test/agent-feedback.test.ts"]),
    stableContract("policy-report", "cypher-llm-policy-report/v1", "policy", "cost-safety-policy", "schemas/policy-report.schema.json", [
      "examples/policy/tool-hash.policy.json"
    ], ["src/policy.ts", "test/policy.test.ts"]),
    stableContract("policy-profile-catalog", "cypher-llm-policy-profile-catalog/v1", "policy", "cost-safety-policy", "schemas/policy-profile.schema.json", [
      "examples/policy/policy-profiles.json"
    ], ["src/policy-profile.ts", "test/policy-profile.test.ts"]),
    stableContract("policy-rules", "cypher-llm-policy-rules/v1", "policy", "cost-safety-policy", "schemas/policy-rules.schema.json", [
      "examples/policy/tool-hash.policy-rules.json"
    ], ["src/policy-rules.ts", "test/policy.test.ts"]),
    stableContract("planner-estimate", "cypher-llm-planner-estimate/v1", "policy", "cost-safety-policy", "schemas/planner-estimate.schema.json", [
      "examples/policy/tool-hash.planner-estimate.json"
    ], ["src/planner-estimate.ts", "test/planner-estimate.test.ts"]),
    stableContract("schema-statistics", "cypher-llm-schema-statistics/v1", "policy", "cost-safety-policy", "schemas/schema-statistics.schema.json", [
      "examples/policy/tool-hash.schema-statistics.json"
    ], ["src/schema-statistics.ts", "test/schema-statistics.test.ts"]),
    stableContract("lsp-diagnostics", "cypher-llm-lsp-diagnostics/v1", "integration", "ecosystem-ux", "schemas/lsp-diagnostics.schema.json", [
      "examples/lsp/tool-hash.lsp.json"
    ], ["src/lsp.ts", "test/lsp.test.ts"]),
    stableContract("lossless-parse", "cypher-llm-lossless-parse/v1", "integration", "lossless-parser-ast", "schemas/lossless-parse.schema.json", [
      "examples/lossless/tool-hash.lossless.json"
    ], ["src/lossless-parser.ts", "test/lossless-parser.test.ts"]),
    stableContract("scorecard", "cypher-llm-cypherbench-scorecard/v1", "benchmark", "public-cypherbench", "schemas/cypherbench-scorecard.schema.json", [
      "examples/benchmarks/tool-hash.scorecard.json"
    ], ["src/scorecard.ts", "test/scorecard.test.ts"]),
    stableContract("benchmark-gate", "cypher-llm-benchmark-gate/v1", "benchmark", "public-cypherbench", "schemas/benchmark-gate.schema.json", [
      "examples/benchmarks/tool-hash.benchmark-gate.json"
    ], ["src/benchmark-gate.ts", "test/benchmark-gate.test.ts"]),
    stableContract("dataset-governance", "cypher-llm-dataset-governance/v1", "benchmark", "public-cypherbench", "schemas/dataset-governance.schema.json", [
      "examples/benchmarks/tool-hash.dataset-governance.json"
    ], ["src/dataset-governance.ts", "test/dataset-governance.test.ts"]),
    stableContract("service-manifest", "cypher-llm-service-manifest/v1", "service", "compiler-service", "schemas/service-manifest.schema.json", [
      "examples/service/service-manifest.json"
    ], ["src/service-manifest.ts", "test/service-manifest.test.ts"]),
    stableContract("years-roadmap", "cypher-llm-years-roadmap/v1", "governance", "governance-standards", "schemas/years-roadmap.schema.json", [
      "examples/roadmap/cypher-llm-years-roadmap.json"
    ], ["src/years-roadmap.ts", "test/years-roadmap.test.ts"]),
    stableContract("compatibility-catalog", "cypher-llm-compatibility-catalog/v1", "governance", "governance-standards", "schemas/compatibility-catalog.schema.json", [
      "examples/governance/compatibility-catalog.json"
    ], ["src/compatibility.ts", "test/compatibility.test.ts"])
  ],
  releaseGates: [
    {
      id: "unit-and-schema-suite",
      title: "Unit, integration, and checked-in schema examples pass",
      command: "npm test",
      evidencePaths: ["package.json", "test/evals.test.ts"]
    },
    {
      id: "package-dry-run",
      title: "Published package contents include public contracts",
      command: "npm run verify:pack",
      evidencePaths: ["package.json"]
    },
    {
      id: "roadmap-integrity",
      title: "Roadmap capability metadata remains internally consistent",
      command: "cypher-llm roadmap --integrity",
      evidencePaths: ["src/years-roadmap.ts", "schemas/years-roadmap.schema.json"]
    }
  ],
  certificationGates: [
    {
      id: "dialect-certification",
      title: "Dialect profile claims are executable",
      command: "cypher-llm certify-dialects --fail-on-fail",
      evidencePaths: ["src/dialect-certification.ts", "examples/certification/dialect-certification.json"]
    },
    {
      id: "compatibility-integrity",
      title: "Compatibility catalog has no duplicate or orphan contract metadata",
      command: "cypher-llm compatibility --integrity",
      evidencePaths: ["src/compatibility.ts", "examples/governance/compatibility-catalog.json"]
    }
  ],
  deprecationPolicy: {
    minimumNotice: "one-minor-release",
    requiresMigrationNote: true,
    requiresReplacementContract: true,
    appliesToLevels: ["stable", "preview"]
  }
} as const satisfies CompatibilityCatalog;

export function buildCompatibilityCatalog(): CompatibilityCatalog {
  return JSON.parse(JSON.stringify(compatibilityCatalog)) as CompatibilityCatalog;
}

export function compatibilityIntegrityReport(catalog: CompatibilityCatalog = compatibilityCatalog): CompatibilityIntegrityReport {
  const diagnostics: string[] = [];
  const levels = new Set(catalog.levels.map((level) => level.level));
  const contracts = new Set<string>();

  for (const contract of catalog.contracts) {
    const key = `${contract.id}:${contract.version}`;
    if (contracts.has(key)) {
      diagnostics.push(`duplicate contract ${key}`);
    }
    contracts.add(key);
    if (!levels.has(contract.level)) {
      diagnostics.push(`contract ${contract.id} references unknown level ${contract.level}`);
    }
    if (contract.examplePaths.length === 0) {
      diagnostics.push(`contract ${contract.id} has no example paths`);
    }
    if (contract.evidencePaths.length === 0) {
      diagnostics.push(`contract ${contract.id} has no evidence paths`);
    }
    if (contract.level === "stable" && contract.breakingChangePolicy.length === 0) {
      diagnostics.push(`stable contract ${contract.id} has no breaking-change policy`);
    }
  }

  for (const gate of [...catalog.releaseGates, ...catalog.certificationGates]) {
    if (gate.command.length === 0) {
      diagnostics.push(`gate ${gate.id} has no command`);
    }
    if (gate.evidencePaths.length === 0) {
      diagnostics.push(`gate ${gate.id} has no evidence paths`);
    }
  }

  return {
    version: "cypher-llm-compatibility-integrity/v1",
    ok: diagnostics.length === 0,
    contracts: catalog.contracts.length,
    stableContracts: catalog.contracts.filter((contract) => contract.level === "stable").length,
    previewContracts: catalog.contracts.filter((contract) => contract.level === "preview").length,
    experimentalContracts: catalog.contracts.filter((contract) => contract.level === "experimental").length,
    diagnostics
  };
}

export function renderCompatibilityCatalogMarkdown(catalog: CompatibilityCatalog = compatibilityCatalog): string {
  const lines = [
    "# Compatibility Catalog",
    "",
    `Package: ${catalog.packageName}@${catalog.packageVersion}`,
    "",
    "## Levels",
    ""
  ];

  for (const level of catalog.levels) {
    lines.push(`- ${level.level}: ${level.title}. ${level.changePolicy}`);
  }

  lines.push("", "## Contracts", "");
  for (const contract of catalog.contracts) {
    lines.push(
      `- ${contract.version}: ${contract.level} ${contract.category}`,
      `  Evidence: ${contract.evidencePaths.join(", ")}`,
      `  Examples: ${contract.examplePaths.join(", ")}`
    );
  }

  lines.push("", "## Release Gates", "");
  for (const gate of catalog.releaseGates) {
    lines.push(`- ${gate.id}: ${gate.command}`);
  }

  return `${lines.join("\n")}\n`;
}

function stableContract(
  id: string,
  version: string,
  category: CompatibilityCategory,
  ownerWorkstreamId: string,
  schemaPath: string | undefined,
  examplePaths: string[],
  evidencePaths: string[]
): CompatibilityContract {
  return {
    id,
    version,
    category,
    level: "stable",
    ownerWorkstreamId,
    ...(schemaPath ? { schemaPath } : {}),
    examplePaths,
    evidencePaths,
    breakingChangePolicy: "Requires a new versioned contract or an explicit migration note before release.",
    deprecationPolicy: "Stable consumers receive at least one minor release of notice plus a replacement or migration path."
  };
}
