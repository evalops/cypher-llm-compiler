export interface AgentGuideWorkflowStep {
  id: string;
  title: string;
  toolName?: string;
  cliCommand?: string;
  inputContract?: string;
  outputContract?: string;
  successSignal: string;
  failureHandling: string;
}

export interface AgentGuideWorkflow {
  id: string;
  title: string;
  goal: string;
  steps: AgentGuideWorkflowStep[];
}

export interface AgentGuideDiagnosticPlaybook {
  codes: string[];
  category: "schema" | "scope" | "syntax" | "safety" | "policy" | "aggregation" | "raw-compatibility";
  preferredAction: "apply-deterministic-repair" | "regenerate-ir" | "request-approval" | "ask-for-schema" | "use-raw-migration";
  preferredTool: string;
  instruction: string;
}

export interface AgentGuide {
  version: "cypher-llm-agent-guide/v1";
  generatedAt: string;
  packageName: "@evalops/cypher-llm-compiler";
  packageVersion: string;
  contractPrinciples: string[];
  authoringRules: {
    preferredInput: "cypher-llm-ir/v1";
    rawCypherUse: string;
    requiredDefaults: {
      defaultLimit: number;
      defaultMaxHops: number;
      parserMode: "syntax" | "lint";
      policyProfileId: string;
    };
    neverExecuteWhen: string[];
  };
  workflows: AgentGuideWorkflow[];
  diagnosticPlaybooks: AgentGuideDiagnosticPlaybook[];
  publicContracts: string[];
  examplePaths: string[];
}

const PACKAGE_VERSION = "0.1.0";

export const agentGuide = {
  version: "cypher-llm-agent-guide/v1",
  generatedAt: "2026-05-10",
  packageName: "@evalops/cypher-llm-compiler",
  packageVersion: PACKAGE_VERSION,
  contractPrinciples: [
    "Prefer cypher-llm-ir/v1 for new generation; use raw Cypher only for migration or source inspection.",
    "Treat compiler diagnostics as model feedback, not user-facing blame.",
    "Apply deterministic repairs before asking the model to regenerate.",
    "Run proof or agent-feedback before execution, and require explicit approval for writes.",
    "Use policy profiles and policy evidence for autonomous agents instead of hidden prompt-only rules.",
    "Keep contract, schema, and example versions pinned when integrating external agent runtimes."
  ],
  authoringRules: {
    preferredInput: "cypher-llm-ir/v1",
    rawCypherUse: "Use raw Cypher paths for legacy text2cypher outputs, round-trip inspection, or migration inventories.",
    requiredDefaults: {
      defaultLimit: 25,
      defaultMaxHops: 5,
      parserMode: "syntax",
      policyProfileId: "llm-readonly-strict"
    },
    neverExecuteWhen: [
      "agent-feedback nextAction.kind is not execute",
      "proof status is blocked",
      "canExecute is false",
      "requiresApproval is true and no external approval was supplied",
      "policy report contains error-severity findings"
    ]
  },
  workflows: [
    {
      id: "author-read-query",
      title: "Author a new read query",
      goal: "Turn a user request and schema contract into executable, bounded Cypher.",
      steps: [
        {
          id: "emit-ir",
          title: "Emit structured IR",
          inputContract: "cypher-llm-schema/v1",
          outputContract: "cypher-llm-ir/v1",
          successSignal: "The query uses explicit variables, declared labels/relationships, and bounded return intent.",
          failureHandling: "Ask for missing schema context instead of inventing labels, relationship types, or properties."
        },
        {
          id: "agent-feedback",
          title: "Get one-shot compiler feedback",
          toolName: "cypher_agent_feedback",
          cliCommand: "cypher-llm agent-feedback --schema schema.json --query query.json --default-limit 25",
          inputContract: "cypher-llm-ir/v1",
          outputContract: "cypher-llm-agent-feedback/v1",
          successSignal: "nextAction.kind is execute.",
          failureHandling: "Follow nextAction.kind and diagnostic playbooks before producing a final query."
        },
        {
          id: "execute-safe-plan",
          title: "Execute only after proof",
          outputContract: "cypher-llm-proof/v1",
          successSignal: "canExecute is true and requiresApproval is false.",
          failureHandling: "Return the repair plan or approval request rather than executing unsafe Cypher."
        }
      ]
    },
    {
      id: "repair-compiler-feedback",
      title: "Repair compiler feedback",
      goal: "Convert diagnostics into deterministic edits or a targeted model regeneration.",
      steps: [
        {
          id: "repair-plan",
          title: "Request ranked repair steps",
          toolName: "cypher_repair_plan",
          cliCommand: "cypher-llm repair-plan --schema schema.json --query query.json --default-limit 25",
          inputContract: "cypher-llm-ir/v1",
          outputContract: "cypher-llm-repair-plan/v1",
          successSignal: "deterministic repairs cover all blocking diagnostics.",
          failureHandling: "Use modelRequired diagnostics as a compact regeneration target."
        },
        {
          id: "recheck",
          title: "Re-run proof after edits",
          toolName: "cypher_prove",
          inputContract: "cypher-llm-ir/v1",
          outputContract: "cypher-llm-proof/v1",
          successSignal: "status is accepted, accepted-with-warnings, or repaired.",
          failureHandling: "Do not execute until the proof status is not blocked."
        }
      ]
    },
    {
      id: "policy-safe-autonomy",
      title: "Run policy-safe autonomous checks",
      goal: "Make cost, tenant, sensitive-data, and write-risk decisions explicit.",
      steps: [
        {
          id: "select-profile",
          title: "Select a named policy profile",
          toolName: "cypher_policy_profiles",
          outputContract: "cypher-llm-policy-profile-catalog/v1",
          successSignal: "The selected profile id is recorded in the policy report.",
          failureHandling: "Default to llm-readonly-strict for autonomous read agents."
        },
        {
          id: "policy-check",
          title: "Run policy check with evidence",
          toolName: "cypher_policy_check",
          cliCommand: "cypher-llm policy-check --schema schema.json --query query.json --policy-profile-id llm-readonly-strict",
          inputContract: "cypher-llm-ir/v1",
          outputContract: "cypher-llm-policy-report/v1",
          successSignal: "ok is true or only warning findings remain after explicit handling.",
          failureHandling: "Treat error findings as blockers unless a human approval path exists."
        },
        {
          id: "policy-eval",
          title: "Benchmark policy decisions",
          toolName: "cypher_policy_eval",
          cliCommand: "cypher-llm policy-eval --dataset dataset.json --attempts attempts.json --policy-profile-id llm-readonly-strict",
          outputContract: "cypher-llm-policy-eval/v1",
          successSignal: "blockedRate and riskyExecutableAttempts are within the release threshold.",
          failureHandling: "Treat risky executable attempts as benchmark regressions until policy findings are resolved or explicitly accepted."
        }
      ]
    },
    {
      id: "legacy-raw-migration",
      title: "Migrate legacy raw Cypher",
      goal: "Inspect and repair existing text2cypher outputs without losing source bytes.",
      steps: [
        {
          id: "conformance-boundary",
          title: "Check the parser fixture boundary",
          toolName: "cypher_lossless_conformance",
          cliCommand: "cypher-llm lossless-conformance --fail-on-fail",
          outputContract: "cypher-llm-lossless-conformance/v1",
          successSignal: "summary.failed is 0 and warning cases are understood.",
          failureHandling: "Block parser-boundary changes until failing fixtures round-trip or are explicitly reclassified."
        },
        {
          id: "parse-lossless",
          title: "Preserve source spans",
          toolName: "cypher_parse_lossless",
          outputContract: "cypher-llm-lossless-parse/v1",
          successSignal: "roundTrip.ok is true.",
          failureHandling: "Use source spans and diagnostics for targeted migration feedback."
        },
        {
          id: "lift-or-repair",
          title: "Lift supported reads into IR",
          toolName: "cypher_repair",
          outputContract: "cypher-llm-ir/v1",
          successSignal: "The query can move to structured IR or has narrow raw repairs.",
          failureHandling: "Keep unsupported clauses explicit as raw-compatible escape hatches."
        }
      ]
    },
    {
      id: "release-compatibility",
      title: "Check release compatibility",
      goal: "Keep agent integrations stable across package releases.",
      steps: [
        {
          id: "catalog",
          title: "Fetch the compatibility catalog",
          toolName: "cypher_compatibility_catalog",
          cliCommand: "cypher-llm compatibility --integrity --fail-on-error",
          outputContract: "cypher-llm-compatibility-catalog/v1",
          successSignal: "integrity.ok is true.",
          failureHandling: "Block the release until duplicate or incomplete contract metadata is fixed."
        },
        {
          id: "service-openapi",
          title: "Fetch service route contract",
          toolName: "cypher_service_openapi",
          cliCommand: "cypher-llm service-openapi --openapi-out service-openapi.json",
          outputContract: "cypher-llm-service-openapi/v1",
          successSignal: "Every advertised route has an operationId and JSON response schema.",
          failureHandling: "Do not integrate HTTP clients against undocumented or schema-less routes."
        },
        {
          id: "diff",
          title: "Compare baseline and candidate catalogs",
          toolName: "cypher_compatibility_diff",
          cliCommand: "cypher-llm compatibility-diff --baseline baseline-catalog.json --fail-on-breaking",
          outputContract: "cypher-llm-compatibility-diff/v1",
          successSignal: "status is passed.",
          failureHandling: "Review warning changes and block breaking changes unless a new contract version and migration plan exist."
        },
        {
          id: "conformance",
          title: "Audit contract evidence",
          toolName: "cypher_contract_conformance",
          cliCommand: "cypher-llm contract-conformance --fail-on-error",
          outputContract: "cypher-llm-contract-conformance/v1",
          successSignal: "summary.failures is 0.",
          failureHandling: "Fix missing files, fingerprint drift, or schema-validation failures before release."
        }
      ]
    }
  ],
  diagnosticPlaybooks: [
    {
      codes: ["missing-limit", "policy-missing-limit", "policy-high-return-limit"],
      category: "policy",
      preferredAction: "apply-deterministic-repair",
      preferredTool: "cypher_repair_plan",
      instruction: "Add or lower RETURN LIMIT before execution; prefer the configured defaultLimit unless the user asked for a smaller bound."
    },
    {
      codes: ["unknown-label", "unknown-relationship-type", "unknown-property", "unknown-parameter"],
      category: "schema",
      preferredAction: "ask-for-schema",
      preferredTool: "cypher_validate",
      instruction: "Use schema aliases when present; otherwise ask for schema context instead of inventing names."
    },
    {
      codes: ["relationship-direction-mismatch"],
      category: "schema",
      preferredAction: "apply-deterministic-repair",
      preferredTool: "cypher_repair_plan",
      instruction: "Let deterministic repair flip direction only when schema endpoints make the change unambiguous."
    },
    {
      codes: ["undefined-variable", "subquery-import-undefined", "subquery-missing-return", "subquery-variable-shadowing"],
      category: "scope",
      preferredAction: "regenerate-ir",
      preferredTool: "cypher_repair_plan",
      instruction: "Regenerate WITH, RETURN, or CALL subquery scopes so every referenced variable is introduced and exported deliberately."
    },
    {
      codes: ["aggregate-in-match-where", "aggregate-alias-required", "ambiguous-aggregation-expression", "invalid-aggregation"],
      category: "aggregation",
      preferredAction: "regenerate-ir",
      preferredTool: "cypher_validate",
      instruction: "Move aggregate predicates after WITH or RETURN, give aggregate outputs stable aliases, and avoid mixing scalar and aggregate projections ambiguously."
    },
    {
      codes: ["unbounded-variable-length-path", "policy-unbounded-traversal", "policy-high-hop-traversal", "policy-high-fanout-relationship"],
      category: "policy",
      preferredAction: "apply-deterministic-repair",
      preferredTool: "cypher_repair_plan",
      instruction: "Bound relationship hops with defaultMaxHops and re-run policy checks before execution."
    },
    {
      codes: ["write-requires-approval", "policy-write-risk"],
      category: "safety",
      preferredAction: "request-approval",
      preferredTool: "cypher_agent_feedback",
      instruction: "Do not execute writes until an external approval path sets allowWrites and approved."
    },
    {
      codes: ["raw-cypher-escape-hatch", "raw-expression-escape-hatch", "dialect-rendering-limitation", "dialect-unsupported-feature"],
      category: "raw-compatibility",
      preferredAction: "use-raw-migration",
      preferredTool: "cypher_parse_lossless",
      instruction: "Preserve source spans and migrate toward structured IR where supported; keep unsupported syntax explicit."
    }
  ],
  publicContracts: [
    "cypher-llm-ir/v1",
    "cypher-llm-schema/v1",
    "cypher-llm-agent-feedback/v1",
    "cypher-llm-repair-plan/v1",
    "cypher-llm-proof/v1",
    "cypher-llm-diagnostic-catalog/v1",
    "cypher-llm-policy-report/v1",
    "cypher-llm-policy-eval/v1",
    "cypher-llm-service-openapi/v1",
    "cypher-llm-lossless-conformance/v1",
    "cypher-llm-compatibility-catalog/v1",
    "cypher-llm-compatibility-diff/v1",
    "cypher-llm-contract-conformance/v1"
  ],
  examplePaths: [
    "examples/tool-hash.query.json",
    "examples/tool-hash.schema.json",
    "examples/proofs/tool-hash.agent-feedback.json",
    "examples/proofs/tool-hash.repair-plan.json",
    "examples/policy/tool-hash.policy-eval.json",
    "examples/service/service-openapi.json",
    "examples/lossless/conformance.json",
    "examples/diagnostics/diagnostic-catalog.json",
    "examples/governance/compatibility-catalog.json",
    "examples/governance/compatibility-diff.json",
    "examples/governance/contract-conformance.json"
  ]
} as const satisfies AgentGuide;

export function buildAgentGuide(): AgentGuide {
  return JSON.parse(JSON.stringify(agentGuide)) as AgentGuide;
}

export function renderAgentGuideMarkdown(guide: AgentGuide = agentGuide): string {
  const lines = [
    "# Cypher LLM Agent Guide",
    "",
    `Package: ${guide.packageName}@${guide.packageVersion}`,
    "",
    "## Rules",
    ""
  ];

  for (const principle of guide.contractPrinciples) {
    lines.push(`- ${principle}`);
  }

  lines.push("", "## Workflows", "");
  for (const workflow of guide.workflows) {
    lines.push(`- ${workflow.id}: ${workflow.goal}`);
    for (const step of workflow.steps) {
      const tool = step.toolName ? ` using ${step.toolName}` : "";
      lines.push(`  - ${step.id}${tool}: ${step.successSignal}`);
    }
  }

  lines.push("", "## Diagnostic Playbooks", "");
  for (const playbook of guide.diagnosticPlaybooks) {
    lines.push(`- ${playbook.codes.join(", ")}: ${playbook.instruction}`);
  }

  return `${lines.join("\n")}\n`;
}
