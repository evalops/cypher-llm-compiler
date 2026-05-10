import { buildCypherAgentFeedback } from "./agent-feedback.js";
import { buildAgentGuide } from "./agent-guide.js";
import { buildBenchmarkGateReport } from "./benchmark-gate.js";
import { buildCompatibilityCatalog, type CompatibilityCatalog } from "./compatibility.js";
import { buildCompatibilityDiffReport } from "./compatibility-diff.js";
import { buildContractConformanceReport } from "./contract-conformance.js";
import { buildDatasetGovernanceReport } from "./dataset-governance.js";
import { buildDiagnosticCatalog } from "./diagnostic-catalog.js";
import type { EvalAttemptSet, EvalDataset, EvalOptions, EvalReport } from "./evals.js";
import { evaluateAttempts } from "./evals.js";
import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import { buildLspDiagnostics } from "./lsp.js";
import { buildLosslessConformanceReport, type LosslessConformanceCase } from "./lossless-conformance.js";
import { parseCypherLosslessly } from "./lossless-parser.js";
import type { ParserValidationOptions } from "./parser-validation.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import type { CypherPlannerEstimate } from "./planner-estimate.js";
import { assessCypherPolicy } from "./policy.js";
import type { CypherPolicyRuleSet } from "./policy-rules.js";
import {
  buildPolicyProfileCatalog,
  getPolicyProfile,
  policyOptionsFromProfile,
  type CypherPolicyProfile
} from "./policy-profile.js";
import { buildCypherProof } from "./proof.js";
import type { RepairOptions } from "./repair.js";
import { repairQuery, repairRawCypher } from "./repair.js";
import { buildCypherRepairPlan } from "./repair-plan.js";
import { renderQuery } from "./render.js";
import { evaluateRetryAttempts, type RetryEvalRoundInput } from "./retry-eval.js";
import type { SafeExecutionOptions } from "./safety.js";
import { createSafeExecutionPlan } from "./safety.js";
import type { CypherSchemaStatistics } from "./schema-statistics.js";
import { buildCypherBenchScorecard } from "./scorecard.js";
import type { ValidationOptions } from "./validate.js";
import { validateQuery } from "./validate.js";

export type JsonSchema = Record<string, unknown>;

export type CypherCompilerToolName =
  | "cypher_render"
  | "cypher_validate"
  | "cypher_repair"
  | "cypher_repair_plan"
  | "cypher_lossless_conformance"
  | "cypher_parse_lossless"
  | "cypher_parse_check"
  | "cypher_policy_check"
  | "cypher_policy_profiles"
  | "cypher_lsp_diagnostics"
  | "cypher_prove"
  | "cypher_agent_feedback"
  | "cypher_agent_guide"
  | "cypher_diagnostic_catalog"
  | "cypher_compatibility_catalog"
  | "cypher_compatibility_diff"
  | "cypher_contract_conformance"
  | "cypher_eval"
  | "cypher_scorecard"
  | "cypher_benchmark_gate"
  | "cypher_retry_eval"
  | "cypher_dataset_governance";

export interface CypherCompilerToolDefinition {
  name: CypherCompilerToolName;
  description: string;
  inputSchema: JsonSchema;
}

export interface OpenAiResponsesToolDefinition {
  type: "function";
  name: CypherCompilerToolName;
  description: string;
  parameters: JsonSchema;
  strict: false;
}

export interface OpenAiChatToolDefinition {
  type: "function";
  function: {
    name: CypherCompilerToolName;
    description: string;
    parameters: JsonSchema;
    strict: false;
  };
}

const jsonLiteralSchema: JsonSchema = {
  description: "JSON-serializable Cypher parameter value.",
  oneOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
    { type: "array", items: {} },
    { type: "object", additionalProperties: true }
  ]
};

const paramsSchema: JsonSchema = {
  type: "object",
  description: "Cypher parameter values keyed by parameter name without the '$' prefix.",
  additionalProperties: jsonLiteralSchema
};

const schemaContractSchema: JsonSchema = {
  type: "object",
  description: "CypherSchemaContract JSON describing labels, relationship types, properties, aliases, and parameters.",
  required: ["version", "nodes", "relationships"],
  additionalProperties: true,
  properties: {
    version: { const: "cypher-llm-schema/v1" },
    dialect: { type: "string" },
    nodes: { type: "array", items: { type: "object", additionalProperties: true } },
    relationships: { type: "array", items: { type: "object", additionalProperties: true } },
    parameters: { type: "object", additionalProperties: true },
    procedures: { type: "object", additionalProperties: true },
    disallowWritesByDefault: { type: "boolean" }
  }
};

const cypherQuerySchema: JsonSchema = {
  type: "object",
  description: "CypherQuery IR JSON. Prefer this over raw Cypher when asking an LLM to author queries.",
  required: ["version", "clauses"],
  additionalProperties: true,
  properties: {
    version: { const: "cypher-llm-ir/v1" },
    profile: { enum: ["llm-safe-readonly", "llm-safe-write", "raw-compatible"] },
    clauses: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } },
    metadata: { type: "object", additionalProperties: true }
  }
};

const evalDatasetSchema: JsonSchema = {
  type: "object",
  description: "EvalDataset JSON containing tasks, schemas, and expectations.",
  required: ["version", "name", "tasks"],
  additionalProperties: true,
  properties: {
    version: { const: "cypher-llm-eval-dataset/v1" },
    name: { type: "string" },
    tasks: { type: "array", items: { type: "object", additionalProperties: true } }
  }
};

const evalAttemptSetSchema: JsonSchema = {
  type: "object",
  description: "EvalAttemptSet JSON containing model attempts as IR, raw Cypher, timeout, or no-Cypher outputs.",
  required: ["version", "attempts"],
  additionalProperties: true,
  properties: {
    version: { const: "cypher-llm-eval-attempts/v1" },
    datasetName: { type: "string" },
    model: { type: "string" },
    prompt: { type: "string" },
    attempts: { type: "array", items: { type: "object", additionalProperties: true } }
  }
};

const evalReportSchema: JsonSchema = {
  type: "object",
  description: "EvalReport JSON produced by cypher_eval or the eval CLI.",
  required: ["version", "datasetName", "metrics", "results"],
  additionalProperties: true,
  properties: {
    version: { const: "cypher-llm-eval-report/v1" },
    datasetName: { type: "string" },
    model: { type: "string" },
    prompt: { type: "string" },
    metrics: { type: "object", additionalProperties: true },
    results: { type: "array", items: { type: "object", additionalProperties: true } }
  }
};

const compatibilityCatalogSchema: JsonSchema = {
  type: "object",
  description: "cypher-llm-compatibility-catalog/v1 catalog JSON.",
  required: ["version", "contracts", "releaseGates", "certificationGates", "deprecationPolicy"],
  additionalProperties: true,
  properties: {
    version: { const: "cypher-llm-compatibility-catalog/v1" },
    packageName: { type: "string" },
    packageVersion: { type: "string" },
    contracts: { type: "array", items: { type: "object", additionalProperties: true } },
    releaseGates: { type: "array", items: { type: "object", additionalProperties: true } },
    certificationGates: { type: "array", items: { type: "object", additionalProperties: true } },
    deprecationPolicy: { type: "object", additionalProperties: true }
  }
};

const repairOptionProperties = {
  defaultLimit: {
    type: "number",
    description: "Add this LIMIT to repaired RETURN clauses that do not already have one."
  },
  defaultMaxHops: {
    type: "number",
    description: "Replace unbounded variable-length paths with this maximum hop count."
  }
} satisfies Record<string, JsonSchema>;

const policyEvidenceProperties = {
  requireLimit: {
    type: "boolean",
    description: "Require RETURN clauses to include LIMIT when assessing policy evidence."
  },
  maxReturnLimit: {
    type: "number",
    description: "Warn when a RETURN LIMIT exceeds this policy maximum."
  },
  maxRelationshipHops: {
    type: "number",
    description: "Block or warn when variable-length relationships exceed this policy maximum."
  },
  plannerEstimate: {
    type: "object",
    description: "Optional cypher-llm-planner-estimate/v1 planner evidence from EXPLAIN or a fixture.",
    additionalProperties: true
  },
  schemaStatistics: {
    type: "object",
    description: "Optional cypher-llm-schema-statistics/v1 cardinality and index metadata.",
    additionalProperties: true
  },
  policyRules: {
    type: "object",
    description: "Optional cypher-llm-policy-rules/v1 sensitivity and tenant-scoping policy rules.",
    additionalProperties: true
  },
  maxEstimatedRows: {
    type: "number",
    description: "Warn when planner-estimated rows exceed this value."
  },
  maxDbHits: {
    type: "number",
    description: "Warn when planner-estimated db hits exceed this value."
  },
  maxLabelScanRows: {
    type: "number",
    description: "Warn when unanchored label scans exceed this schema-statistics row count."
  },
  maxRelationshipFanout: {
    type: "number",
    description: "Warn when relationship average fanout exceeds this schema-statistics value."
  },
  warnOnPlanOperators: {
    type: "array",
    items: { type: "string" },
    description: "Planner operator names that should produce warning findings."
  }
} satisfies Record<string, JsonSchema>;

export const CYPHER_COMPILER_TOOLS: readonly CypherCompilerToolDefinition[] = [
  {
    name: "cypher_render",
    description:
      "Repair structured Cypher IR, validate it against a schema contract, and render a safe execution plan with EXPLAIN preflight text.",
    inputSchema: objectSchema(["schema", "query"], {
      schema: schemaContractSchema,
      query: cypherQuerySchema,
      params: paramsSchema,
      ...repairOptionProperties,
      allowWrites: {
        type: "boolean",
        description: "Allow write clauses to pass validation. Use only after an external approval step."
      },
      approved: {
        type: "boolean",
        description: "Mark a write query as externally approved when allowWrites is also true."
      },
      mode: {
        enum: ["explain", "readonly", "write-requires-approval"],
        description: "Execution mode metadata for the returned SafeExecutionPlan."
      }
    })
  },
  {
    name: "cypher_validate",
    description: "Validate structured Cypher IR against schema, scope, parameter, aggregate, path, and write-safety rules.",
    inputSchema: objectSchema(["schema", "query"], {
      schema: schemaContractSchema,
      query: cypherQuerySchema,
      requireKnownParameters: { type: "boolean" },
      warnOnMissingLimit: { type: "boolean" },
      warnOnRawCypher: { type: "boolean" },
      disallowWrites: { type: "boolean" }
    })
  },
  {
    name: "cypher_repair",
    description:
      "Repair Cypher. Structured IR gets deterministic AST repairs; raw Cypher gets narrow migration repairs, source-positioned text edits, and diagnostics.",
    inputSchema: objectSchema(["schema"], {
      schema: schemaContractSchema,
      query: cypherQuerySchema,
      rawCypher: {
        type: "string",
        description: "Legacy raw Cypher text to repair during migration. Prefer query for new generation."
      },
      ...repairOptionProperties
    })
  },
  {
    name: "cypher_repair_plan",
    description:
      "Build a source-anchored ranked repair plan for Cypher IR, separating deterministic JSON-patch repairs, model-required fixes, and unsafe or approval-gated blockers.",
    inputSchema: objectSchema(["schema", "query"], {
      schema: schemaContractSchema,
      query: cypherQuerySchema,
      params: paramsSchema,
      ...repairOptionProperties,
      ...policyEvidenceProperties,
      allowWrites: {
        type: "boolean",
        description: "Allow write clauses in policy assessment."
      },
      approved: {
        type: "boolean",
        description: "Mark write query as externally approved."
      },
      parserMode: {
        enum: ["lint", "syntax"],
        description: "Parser preflight mode for the repaired Cypher."
      }
    })
  },
  {
    name: "cypher_lossless_conformance",
    description:
      "Run the lossless parser conformance matrix over representative Neo4j, openCypher, GQL-oriented, and text2cypher cases.",
    inputSchema: objectSchema([], {
      cases: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          required: ["id", "title", "source", "dialect", "cypher"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            source: { enum: ["neo4j-example", "opencypher-tck", "gql-oriented", "text2cypher"] },
            dialect: { type: "string" },
            cypher: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            schema: schemaContractSchema,
            parserMode: { enum: ["lint", "syntax"] },
            requireParserOk: { type: "boolean" }
          }
        }
      }
    })
  },
  {
    name: "cypher_parse_lossless",
    description:
      "Parse raw Cypher into a lossless concrete syntax report with exact round-trip fragments, comments, source-map anchors, source spans, parser diagnostics, and an IR preview when supported.",
    inputSchema: objectSchema(["rawCypher"], {
      rawCypher: {
        type: "string",
        description: "Raw Cypher source to preserve and inspect without changing bytes."
      },
      schema: schemaContractSchema,
      parserMode: {
        enum: ["lint", "syntax"],
        description: "Parser preflight mode when schema is provided."
      },
      includeIrPreview: {
        type: "boolean",
        description: "Set false to skip raw-to-IR preview generation."
      }
    })
  },
  {
    name: "cypher_parse_check",
    description:
      "Run Neo4j language-support parser validation on rendered IR or raw Cypher and map parser diagnostics to stable compiler diagnostics.",
    inputSchema: objectSchema(["schema"], {
      schema: schemaContractSchema,
      query: cypherQuerySchema,
      rawCypher: { type: "string" },
      mode: { enum: ["lint", "syntax"], description: "Use lint for semantic checks or syntax for parser-only checks." },
      ...repairOptionProperties
    })
  },
  {
    name: "cypher_policy_check",
    description:
      "Assess static cost, cardinality, and safety policy for LLM-generated Cypher IR, including broad scans, missing or high limits, traversal hop risk, cartesian patterns, and writes.",
    inputSchema: objectSchema(["schema", "query"], {
      schema: schemaContractSchema,
      query: cypherQuerySchema,
      policyProfile: {
        type: "object",
        description: "Optional cypher-llm-policy-profile/v1 profile to apply before explicit option overrides.",
        additionalProperties: true
      },
      policyProfileId: {
        type: "string",
        description: "Built-in policy profile id, such as llm-readonly-strict."
      },
      plannerEstimate: {
        type: "object",
        description: "Optional cypher-llm-planner-estimate/v1 planner evidence from EXPLAIN or a fixture.",
        additionalProperties: true
      },
      schemaStatistics: {
        type: "object",
        description: "Optional cypher-llm-schema-statistics/v1 cardinality and index metadata.",
        additionalProperties: true
      },
      policyRules: {
        type: "object",
        description: "Optional cypher-llm-policy-rules/v1 sensitivity and tenant-scoping policy rules.",
        additionalProperties: true
      },
      allowWrites: {
        type: "boolean",
        description: "Allow write clauses in policy assessment."
      },
      requireLimit: {
        type: "boolean",
        description: "Require RETURN clauses to include a LIMIT."
      },
      maxReturnLimit: {
        type: "number",
        description: "Warn when a literal RETURN limit exceeds this value."
      },
      maxRelationshipHops: {
        type: "number",
        description: "Warn when maxHops exceeds this value; unbounded traversals are errors."
      },
      maxEstimatedRows: {
        type: "number",
        description: "Warn when planner-estimated rows exceed this value."
      },
      maxDbHits: {
        type: "number",
        description: "Warn when planner-estimated db hits exceed this value."
      },
      maxLabelScanRows: {
        type: "number",
        description: "Warn when unanchored label scans exceed this schema-statistics row count."
      },
      maxRelationshipFanout: {
        type: "number",
        description: "Warn when relationship average fanout exceeds this schema-statistics value."
      },
      warnOnPlanOperators: {
        type: "array",
        items: { type: "string" },
        description: "Planner operator names that should produce warning findings."
      }
    })
  },
  {
    name: "cypher_policy_profiles",
    description: "List built-in Cypher policy profiles that can be passed to cypher_policy_check.",
    inputSchema: objectSchema([], {})
  },
  {
    name: "cypher_lsp_diagnostics",
    description:
      "Build LSP-style diagnostics and code actions for structured Cypher IR or raw Cypher using compiler, parser, policy, repair outputs, and exact text edits when available.",
    inputSchema: objectSchema(["schema"], {
      schema: schemaContractSchema,
      query: cypherQuerySchema,
      rawCypher: { type: "string" },
      uri: {
        type: "string",
        description: "Document URI to attach to the diagnostic report."
      },
      parserMode: {
        enum: ["lint", "syntax"],
        description: "Parser preflight mode for diagnostics."
      },
      ...repairOptionProperties
    })
  },
  {
    name: "cypher_prove",
    description:
      "Compile Cypher IR into proof-carrying output: rendered Cypher, repairs, diagnostics, parser preflight, execution-policy status, and blocking reasons.",
    inputSchema: objectSchema(["schema", "query"], {
      schema: schemaContractSchema,
      query: cypherQuerySchema,
      params: paramsSchema,
      ...repairOptionProperties,
      ...policyEvidenceProperties,
      allowWrites: {
        type: "boolean",
        description: "Allow write clauses to pass validation. Use only after an external approval step."
      },
      approved: {
        type: "boolean",
        description: "Mark a write query as externally approved when allowWrites is also true."
      },
      mode: {
        enum: ["explain", "readonly", "write-requires-approval"],
        description: "Execution mode metadata for the returned proof."
      },
      parserMode: {
        enum: ["lint", "syntax"],
        description: "Parser preflight mode for the rendered Cypher."
      },
      includeParser: {
        type: "boolean",
        description: "Set false to skip parser preflight in constrained environments."
      }
    })
  },
  {
    name: "cypher_agent_feedback",
    description:
      "Return one agent-facing feedback packet with proof, repair plan, policy evidence, and the next action an LLM client should take.",
    inputSchema: objectSchema(["schema", "query"], {
      schema: schemaContractSchema,
      query: cypherQuerySchema,
      params: paramsSchema,
      ...repairOptionProperties,
      ...policyEvidenceProperties,
      allowWrites: {
        type: "boolean",
        description: "Allow write clauses to pass validation. Use only after an external approval step."
      },
      approved: {
        type: "boolean",
        description: "Mark a write query as externally approved when allowWrites is also true."
      },
      mode: {
        enum: ["explain", "readonly", "write-requires-approval"],
        description: "Execution mode metadata for the nested proof."
      },
      parserMode: {
        enum: ["lint", "syntax"],
        description: "Parser preflight mode for the rendered Cypher."
      },
      includeParser: {
        type: "boolean",
        description: "Set false to skip parser preflight in constrained environments."
      }
    })
  },
  {
    name: "cypher_agent_guide",
    description:
      "Return the machine-readable agent guide: recommended Cypher IR workflow, tool sequences, execution rules, and diagnostic playbooks for LLM clients.",
    inputSchema: objectSchema([], {})
  },
  {
    name: "cypher_diagnostic_catalog",
    description:
      "Return the machine-readable diagnostic catalog: stable codes, severity, source, category, preferred action, and model repair instructions.",
    inputSchema: objectSchema([], {})
  },
  {
    name: "cypher_compatibility_catalog",
    description:
      "Return the machine-readable compatibility catalog: contract versions, stability levels, schema/example fingerprints, release gates, certification gates, and deprecation policy.",
    inputSchema: objectSchema([], {})
  },
  {
    name: "cypher_compatibility_diff",
    description:
      "Compare two compatibility catalogs and classify added, removed, changed, fingerprint, warning, and breaking public contract changes.",
    inputSchema: objectSchema(["baseline"], {
      baseline: compatibilityCatalogSchema,
      candidate: compatibilityCatalogSchema
    })
  },
  {
    name: "cypher_contract_conformance",
    description:
      "Return a contract conformance report that checks public schemas, examples, fingerprints, schema validation, and evidence paths.",
    inputSchema: objectSchema([], {})
  },
  {
    name: "cypher_eval",
    description: "Score offline text2cypher or IR attempts against a Cypher LLM eval dataset.",
    inputSchema: objectSchema(["dataset", "attempts"], {
      dataset: evalDatasetSchema,
      attempts: evalAttemptSetSchema,
      ...repairOptionProperties,
      rawCypherCanExecute: {
        type: "boolean",
        description: "Count raw Cypher attempts as executable when raw repair did not find blocking diagnostics."
      }
    })
  },
  {
    name: "cypher_scorecard",
    description:
      "Build a publishable CypherBench scorecard from one or more eval reports, including lane rankings, diagnostics, and baseline comparisons.",
    inputSchema: objectSchema(["reports"], {
      reports: {
        type: "array",
        minItems: 1,
        items: evalReportSchema
      },
      name: {
        type: "string",
        description: "Human-readable scorecard name."
      },
      baselineIndex: {
        type: "number",
        description: "Zero-based report index to use as the comparison baseline."
      }
    })
  },
  {
    name: "cypher_benchmark_gate",
    description:
      "Build a CI-friendly CypherBench gate report that fails on directional metric regressions and optional pass/executable-rate floors.",
    inputSchema: objectSchema(["baseline", "candidate"], {
      baseline: evalReportSchema,
      candidate: evalReportSchema,
      tolerance: {
        type: "number",
        description: "Numeric tolerance for metric deltas and floors."
      },
      minPassRate: {
        type: "number",
        description: "Optional minimum candidate pass rate."
      },
      minExecutableRate: {
        type: "number",
        description: "Optional minimum candidate executable rate."
      },
      failOnDiagnosticRegression: {
        type: "boolean",
        description: "Fail when diagnostic-code counts increase."
      }
    })
  },
  {
    name: "cypher_retry_eval",
    description:
      "Evaluate multiple model retry rounds over a CypherBench dataset, including per-task convergence, retry-packet resolution, and multi-attempt metrics.",
    inputSchema: objectSchema(["dataset", "rounds"], {
      dataset: evalDatasetSchema,
      rounds: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["attempts"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            attempts: evalAttemptSetSchema
          }
        }
      },
      ...repairOptionProperties,
      rawCypherCanExecute: {
        type: "boolean",
        description: "Count raw Cypher attempts as executable when raw repair did not find blocking diagnostics."
      }
    })
  },
  {
    name: "cypher_dataset_governance",
    description:
      "Audit a CypherBench eval dataset for machine-readable provenance, split assignment, redaction findings, duplicate ids, and governance diagnostics.",
    inputSchema: objectSchema(["dataset"], {
      dataset: evalDatasetSchema,
      defaultSplit: {
        type: "string",
        description: "Fallback split for tasks without a split:* tag."
      }
    })
  }
];

export const openAiResponsesTools: readonly OpenAiResponsesToolDefinition[] = CYPHER_COMPILER_TOOLS.map((tool) => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.inputSchema,
  strict: false
}));

export const openAiChatTools: readonly OpenAiChatToolDefinition[] = CYPHER_COMPILER_TOOLS.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false
  }
}));

export function getOpenAiResponsesTools(): OpenAiResponsesToolDefinition[] {
  return openAiResponsesTools.map((tool) => ({ ...tool }));
}

export function getOpenAiChatTools(): OpenAiChatToolDefinition[] {
  return openAiChatTools.map((tool) => ({
    type: "function",
    function: { ...tool.function }
  }));
}

export async function executeCypherCompilerTool(name: string, input: unknown): Promise<unknown> {
  const args = objectInput(input, name);

  switch (name) {
    case "cypher_render": {
      const options = safeExecutionOptions(args);
      return createSafeExecutionPlan(
        requiredObject<CypherQuery>(args, "query"),
        requiredObject<CypherSchemaContract>(args, "schema"),
        optionalParams(args),
        options
      );
    }
    case "cypher_validate": {
      return validateQuery(
        requiredObject<CypherQuery>(args, "query"),
        requiredObject<CypherSchemaContract>(args, "schema"),
        validationOptions(args)
      );
    }
    case "cypher_repair": {
      const schema = requiredObject<CypherSchemaContract>(args, "schema");
      if (hasOwn(args, "query")) {
        const repaired = repairQuery(requiredObject<CypherQuery>(args, "query"), schema, repairOptions(args));
        return {
          ...repaired,
          cypher: renderQuery(repaired.query)
        };
      }
      const rawCypher = optionalString(args, "rawCypher");
      if (rawCypher !== undefined) {
        return repairRawCypher(rawCypher, schema);
      }
      throw new Error("cypher_repair requires either 'query' or 'rawCypher'.");
    }
    case "cypher_repair_plan": {
      return buildCypherRepairPlan(
        requiredObject<CypherQuery>(args, "query"),
        requiredObject<CypherSchemaContract>(args, "schema"),
        repairPlanOptions(args)
      );
    }
    case "cypher_lossless_conformance": {
      return buildLosslessConformanceReport(optionalArray<LosslessConformanceCase>(args, "cases"));
    }
    case "cypher_parse_check": {
      const schema = requiredObject<CypherSchemaContract>(args, "schema");
      const mode = parseMode(args);
      const rawCypher = optionalString(args, "rawCypher");
      if (rawCypher !== undefined) {
        return validateCypherTextWithParser(rawCypher, schema, { mode });
      }
      const repaired = repairQuery(requiredObject<CypherQuery>(args, "query"), schema, repairOptions(args));
      const parserResult = validateCypherTextWithParser(renderQuery(repaired.query), schema, { mode });
      return {
        ...parserResult,
        repairs: repaired.applied,
        compilerDiagnostics: repaired.diagnostics
      };
    }
    case "cypher_parse_lossless": {
      return parseCypherLosslessly(requiredString(args, "rawCypher"), losslessParseOptions(args));
    }
    case "cypher_policy_check": {
      return assessCypherPolicy(
        requiredObject<CypherQuery>(args, "query"),
        requiredObject<CypherSchemaContract>(args, "schema"),
        policyOptions(args)
      );
    }
    case "cypher_policy_profiles": {
      return buildPolicyProfileCatalog();
    }
    case "cypher_lsp_diagnostics": {
      const schema = requiredObject<CypherSchemaContract>(args, "schema");
      const rawCypher = optionalString(args, "rawCypher");
      if (rawCypher !== undefined) {
        return buildLspDiagnostics({ schema, rawCypher }, lspOptions(args));
      }
      return buildLspDiagnostics({ schema, query: requiredObject<CypherQuery>(args, "query") }, lspOptions(args));
    }
    case "cypher_prove": {
      return buildCypherProof(
        requiredObject<CypherQuery>(args, "query"),
        requiredObject<CypherSchemaContract>(args, "schema"),
        optionalParams(args),
        proofOptions(args)
      );
    }
    case "cypher_agent_feedback": {
      return buildCypherAgentFeedback(
        requiredObject<CypherQuery>(args, "query"),
        requiredObject<CypherSchemaContract>(args, "schema"),
        optionalParams(args),
        proofOptions(args)
      );
    }
    case "cypher_compatibility_catalog": {
      return buildCompatibilityCatalog();
    }
    case "cypher_agent_guide": {
      return buildAgentGuide();
    }
    case "cypher_diagnostic_catalog": {
      return buildDiagnosticCatalog();
    }
    case "cypher_compatibility_diff": {
      return buildCompatibilityDiffReport(
        requiredObject<CompatibilityCatalog>(args, "baseline"),
        optionalObject<CompatibilityCatalog>(args, "candidate") ?? buildCompatibilityCatalog()
      );
    }
    case "cypher_contract_conformance": {
      return buildContractConformanceReport();
    }
    case "cypher_eval": {
      return evaluateAttempts(
        requiredObject<EvalDataset>(args, "dataset"),
        requiredObject<EvalAttemptSet>(args, "attempts"),
        evalOptions(args)
      );
    }
    case "cypher_scorecard": {
      return buildCypherBenchScorecard(requiredArray<EvalReport>(args, "reports"), scorecardOptions(args));
    }
    case "cypher_benchmark_gate": {
      return buildBenchmarkGateReport(requiredObject<EvalReport>(args, "baseline"), requiredObject<EvalReport>(args, "candidate"), benchmarkGateOptions(args));
    }
    case "cypher_retry_eval": {
      return evaluateRetryAttempts(
        requiredObject<EvalDataset>(args, "dataset"),
        requiredArray<RetryEvalRoundInput>(args, "rounds"),
        evalOptions(args)
      );
    }
    case "cypher_dataset_governance": {
      return buildDatasetGovernanceReport(requiredObject<EvalDataset>(args, "dataset"), datasetGovernanceOptions(args));
    }
    default:
      throw new Error(`Unknown Cypher compiler tool '${name}'.`);
  }
}

function objectSchema(required: string[], properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties
  };
}

function objectInput(input: unknown, toolName: string): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new Error(`${toolName} expects a JSON object input.`);
  }
  return input;
}

function requiredObject<T>(args: Record<string, unknown>, name: string): T {
  const value = args[name];
  if (!isRecord(value)) {
    throw new Error(`Missing required object argument '${name}'.`);
  }
  return value as T;
}

function optionalObject<T>(args: Record<string, unknown>, name: string): T | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Expected '${name}' to be an object.`);
  }
  return value as T;
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = optionalString(args, name);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required string argument '${name}'.`);
  }
  return value;
}

function requiredArray<T>(args: Record<string, unknown>, name: string): T[] {
  const value = args[name];
  if (!Array.isArray(value)) {
    throw new Error(`Missing required array argument '${name}'.`);
  }
  return value as T[];
}

function optionalArray<T>(args: Record<string, unknown>, name: string): T[] | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Expected '${name}' to be an array.`);
  }
  return value as T[];
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected '${name}' to be a string.`);
  }
  return value;
}

function optionalBoolean(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Expected '${name}' to be a boolean.`);
  }
  return value;
}

function optionalNumber(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected '${name}' to be a finite number.`);
  }
  return value;
}

function optionalStringArray(args: Record<string, unknown>, name: string): string[] | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Expected '${name}' to be an array of strings.`);
  }
  return value as string[];
}

function optionalParams(args: Record<string, unknown>): Record<string, JsonLiteral> {
  const value = args.params;
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("Expected 'params' to be a JSON object.");
  }
  return value as Record<string, JsonLiteral>;
}

function repairOptions(args: Record<string, unknown>): RepairOptions {
  const options: RepairOptions = {};
  const defaultLimit = optionalNumber(args, "defaultLimit");
  const defaultMaxHops = optionalNumber(args, "defaultMaxHops");
  if (defaultLimit !== undefined) {
    options.defaultLimit = defaultLimit;
  }
  if (defaultMaxHops !== undefined) {
    options.defaultMaxHops = defaultMaxHops;
  }
  return options;
}

function safeExecutionOptions(args: Record<string, unknown>): SafeExecutionOptions {
  const options: SafeExecutionOptions = { ...repairOptions(args) };
  const allowWrites = optionalBoolean(args, "allowWrites");
  const approved = optionalBoolean(args, "approved");
  const mode = optionalString(args, "mode");
  if (allowWrites !== undefined) {
    options.allowWrites = allowWrites;
  }
  if (approved !== undefined) {
    options.approved = approved;
  }
  if (mode !== undefined) {
    if (mode !== "explain" && mode !== "readonly" && mode !== "write-requires-approval") {
      throw new Error("Expected 'mode' to be explain, readonly, or write-requires-approval.");
    }
    options.mode = mode;
  }
  return options;
}

function proofOptions(args: Record<string, unknown>) {
  const options = safeExecutionOptions(args) as ReturnType<typeof safeExecutionOptions> & {
    parserMode?: Required<ParserValidationOptions>["mode"];
    includeParser?: boolean;
    requireLimit?: boolean;
    maxReturnLimit?: number;
    maxRelationshipHops?: number;
    plannerEstimate?: CypherPlannerEstimate;
    schemaStatistics?: CypherSchemaStatistics;
    policyRules?: CypherPolicyRuleSet;
    maxEstimatedRows?: number;
    maxDbHits?: number;
    maxLabelScanRows?: number;
    maxRelationshipFanout?: number;
    warnOnPlanOperators?: string[];
  };
  const parserMode = optionalString(args, "parserMode");
  const includeParser = optionalBoolean(args, "includeParser");
  if (parserMode !== undefined) {
    if (parserMode !== "lint" && parserMode !== "syntax") {
      throw new Error("Expected 'parserMode' to be lint or syntax.");
    }
    options.parserMode = parserMode;
  }
  if (includeParser !== undefined) {
    options.includeParser = includeParser;
  }
  Object.assign(options, policyEvidenceOptions(args));
  return options;
}

function repairPlanOptions(args: Record<string, unknown>) {
  const options: {
    defaultLimit?: number;
    defaultMaxHops?: number;
    params?: Record<string, JsonLiteral>;
    allowWrites?: boolean;
    approved?: boolean;
    parserMode?: Required<ParserValidationOptions>["mode"];
    requireLimit?: boolean;
    maxReturnLimit?: number;
    maxRelationshipHops?: number;
    plannerEstimate?: CypherPlannerEstimate;
    schemaStatistics?: CypherSchemaStatistics;
    policyRules?: CypherPolicyRuleSet;
    maxEstimatedRows?: number;
    maxDbHits?: number;
    maxLabelScanRows?: number;
    maxRelationshipFanout?: number;
    warnOnPlanOperators?: string[];
  } = { ...repairOptions(args) };
  const params = optionalParams(args);
  const allowWrites = optionalBoolean(args, "allowWrites");
  const approved = optionalBoolean(args, "approved");
  const parserMode = optionalString(args, "parserMode");
  if (Object.keys(params).length > 0) {
    options.params = params;
  }
  if (allowWrites !== undefined) {
    options.allowWrites = allowWrites;
  }
  if (approved !== undefined) {
    options.approved = approved;
  }
  if (parserMode !== undefined) {
    if (parserMode !== "lint" && parserMode !== "syntax") {
      throw new Error("Expected 'parserMode' to be lint or syntax.");
    }
    options.parserMode = parserMode;
  }
  Object.assign(options, policyEvidenceOptions(args));
  return options;
}

function policyEvidenceOptions(args: Record<string, unknown>) {
  const options: {
    requireLimit?: boolean;
    maxReturnLimit?: number;
    maxRelationshipHops?: number;
    plannerEstimate?: CypherPlannerEstimate;
    schemaStatistics?: CypherSchemaStatistics;
    policyRules?: CypherPolicyRuleSet;
    maxEstimatedRows?: number;
    maxDbHits?: number;
    maxLabelScanRows?: number;
    maxRelationshipFanout?: number;
    warnOnPlanOperators?: string[];
  } = {};
  const plannerEstimate = optionalObject<CypherPlannerEstimate>(args, "plannerEstimate");
  const schemaStatistics = optionalObject<CypherSchemaStatistics>(args, "schemaStatistics");
  const policyRules = optionalObject<CypherPolicyRuleSet>(args, "policyRules");
  const requireLimit = optionalBoolean(args, "requireLimit");
  const maxReturnLimit = optionalNumber(args, "maxReturnLimit");
  const maxRelationshipHops = optionalNumber(args, "maxRelationshipHops");
  const maxEstimatedRows = optionalNumber(args, "maxEstimatedRows");
  const maxDbHits = optionalNumber(args, "maxDbHits");
  const maxLabelScanRows = optionalNumber(args, "maxLabelScanRows");
  const maxRelationshipFanout = optionalNumber(args, "maxRelationshipFanout");
  const warnOnPlanOperators = optionalStringArray(args, "warnOnPlanOperators");
  if (requireLimit !== undefined) {
    options.requireLimit = requireLimit;
  }
  if (maxReturnLimit !== undefined) {
    options.maxReturnLimit = maxReturnLimit;
  }
  if (maxRelationshipHops !== undefined) {
    options.maxRelationshipHops = maxRelationshipHops;
  }
  if (plannerEstimate !== undefined) {
    options.plannerEstimate = plannerEstimate;
  }
  if (schemaStatistics !== undefined) {
    options.schemaStatistics = schemaStatistics;
  }
  if (policyRules !== undefined) {
    options.policyRules = policyRules;
  }
  if (maxEstimatedRows !== undefined) {
    options.maxEstimatedRows = maxEstimatedRows;
  }
  if (maxDbHits !== undefined) {
    options.maxDbHits = maxDbHits;
  }
  if (maxLabelScanRows !== undefined) {
    options.maxLabelScanRows = maxLabelScanRows;
  }
  if (maxRelationshipFanout !== undefined) {
    options.maxRelationshipFanout = maxRelationshipFanout;
  }
  if (warnOnPlanOperators !== undefined) {
    options.warnOnPlanOperators = warnOnPlanOperators;
  }
  return options;
}

function policyOptions(args: Record<string, unknown>) {
  const overrides: {
    allowWrites?: boolean;
    requireLimit?: boolean;
    maxReturnLimit?: number;
    maxRelationshipHops?: number;
    maxEstimatedRows?: number;
    maxDbHits?: number;
    maxLabelScanRows?: number;
    maxRelationshipFanout?: number;
    warnOnPlanOperators?: string[];
    plannerEstimate?: CypherPlannerEstimate;
    schemaStatistics?: CypherSchemaStatistics;
    policyRules?: CypherPolicyRuleSet;
  } = {};
  const policyProfile = optionalObject<CypherPolicyProfile>(args, "policyProfile");
  const policyProfileId = optionalString(args, "policyProfileId");
  const plannerEstimate = optionalObject<CypherPlannerEstimate>(args, "plannerEstimate");
  const schemaStatistics = optionalObject<CypherSchemaStatistics>(args, "schemaStatistics");
  const policyRules = optionalObject<CypherPolicyRuleSet>(args, "policyRules");
  const allowWrites = optionalBoolean(args, "allowWrites");
  const requireLimit = optionalBoolean(args, "requireLimit");
  const maxReturnLimit = optionalNumber(args, "maxReturnLimit");
  const maxRelationshipHops = optionalNumber(args, "maxRelationshipHops");
  const maxEstimatedRows = optionalNumber(args, "maxEstimatedRows");
  const maxDbHits = optionalNumber(args, "maxDbHits");
  const maxLabelScanRows = optionalNumber(args, "maxLabelScanRows");
  const maxRelationshipFanout = optionalNumber(args, "maxRelationshipFanout");
  const warnOnPlanOperators = optionalStringArray(args, "warnOnPlanOperators");
  if (policyProfile !== undefined && policyProfileId !== undefined) {
    throw new Error("Use either 'policyProfile' or 'policyProfileId', not both.");
  }
  if (allowWrites !== undefined) {
    overrides.allowWrites = allowWrites;
  }
  if (requireLimit !== undefined) {
    overrides.requireLimit = requireLimit;
  }
  if (maxReturnLimit !== undefined) {
    overrides.maxReturnLimit = maxReturnLimit;
  }
  if (maxRelationshipHops !== undefined) {
    overrides.maxRelationshipHops = maxRelationshipHops;
  }
  if (maxEstimatedRows !== undefined) {
    overrides.maxEstimatedRows = maxEstimatedRows;
  }
  if (maxDbHits !== undefined) {
    overrides.maxDbHits = maxDbHits;
  }
  if (maxLabelScanRows !== undefined) {
    overrides.maxLabelScanRows = maxLabelScanRows;
  }
  if (maxRelationshipFanout !== undefined) {
    overrides.maxRelationshipFanout = maxRelationshipFanout;
  }
  if (warnOnPlanOperators !== undefined) {
    overrides.warnOnPlanOperators = warnOnPlanOperators;
  }
  if (plannerEstimate !== undefined) {
    overrides.plannerEstimate = plannerEstimate;
  }
  if (schemaStatistics !== undefined) {
    overrides.schemaStatistics = schemaStatistics;
  }
  if (policyRules !== undefined) {
    overrides.policyRules = policyRules;
  }
  if (policyProfile !== undefined) {
    return policyOptionsFromProfile(policyProfile, overrides);
  }
  if (policyProfileId !== undefined) {
    return policyOptionsFromProfile(getPolicyProfile(policyProfileId), overrides);
  }
  return overrides;
}

function lspOptions(args: Record<string, unknown>) {
  const options = repairOptions(args) as ReturnType<typeof repairOptions> & {
    uri?: string;
    parserMode?: ParserValidationOptions["mode"];
  };
  const uri = optionalString(args, "uri");
  const parserMode = optionalString(args, "parserMode");
  if (uri !== undefined) {
    options.uri = uri;
  }
  if (parserMode !== undefined) {
    if (parserMode !== "lint" && parserMode !== "syntax") {
      throw new Error("Expected 'parserMode' to be lint or syntax.");
    }
    options.parserMode = parserMode;
  }
  return options;
}

function losslessParseOptions(args: Record<string, unknown>) {
  const options: {
    schema?: CypherSchemaContract;
    parserMode?: ParserValidationOptions["mode"];
    includeIrPreview?: boolean;
  } = {};
  const schema = optionalObject<CypherSchemaContract>(args, "schema");
  const parserMode = optionalString(args, "parserMode");
  const includeIrPreview = optionalBoolean(args, "includeIrPreview");
  if (schema !== undefined) {
    options.schema = schema;
  }
  if (parserMode !== undefined) {
    if (parserMode !== "lint" && parserMode !== "syntax") {
      throw new Error("Expected 'parserMode' to be lint or syntax.");
    }
    options.parserMode = parserMode;
  }
  if (includeIrPreview !== undefined) {
    options.includeIrPreview = includeIrPreview;
  }
  return options;
}

function validationOptions(args: Record<string, unknown>): ValidationOptions {
  const options: ValidationOptions = {};
  const requireKnownParameters = optionalBoolean(args, "requireKnownParameters");
  const warnOnMissingLimit = optionalBoolean(args, "warnOnMissingLimit");
  const warnOnRawCypher = optionalBoolean(args, "warnOnRawCypher");
  const disallowWrites = optionalBoolean(args, "disallowWrites");
  if (requireKnownParameters !== undefined) {
    options.requireKnownParameters = requireKnownParameters;
  }
  if (warnOnMissingLimit !== undefined) {
    options.warnOnMissingLimit = warnOnMissingLimit;
  }
  if (warnOnRawCypher !== undefined) {
    options.warnOnRawCypher = warnOnRawCypher;
  }
  if (disallowWrites !== undefined) {
    options.disallowWrites = disallowWrites;
  }
  return options;
}

function evalOptions(args: Record<string, unknown>): EvalOptions {
  const options: EvalOptions = { ...repairOptions(args) };
  const rawCypherCanExecute = optionalBoolean(args, "rawCypherCanExecute");
  if (rawCypherCanExecute !== undefined) {
    options.rawCypherCanExecute = rawCypherCanExecute;
  }
  return options;
}

function scorecardOptions(args: Record<string, unknown>) {
  const options: {
    name?: string;
    baselineIndex?: number;
  } = {};
  const name = optionalString(args, "name");
  const baselineIndex = optionalNumber(args, "baselineIndex");
  if (name !== undefined) {
    options.name = name;
  }
  if (baselineIndex !== undefined) {
    options.baselineIndex = baselineIndex;
  }
  return options;
}

function benchmarkGateOptions(args: Record<string, unknown>) {
  const options: {
    tolerance?: number;
    minPassRate?: number;
    minExecutableRate?: number;
    failOnDiagnosticRegression?: boolean;
  } = {};
  const tolerance = optionalNumber(args, "tolerance");
  const minPassRate = optionalNumber(args, "minPassRate");
  const minExecutableRate = optionalNumber(args, "minExecutableRate");
  const failOnDiagnosticRegression = optionalBoolean(args, "failOnDiagnosticRegression");
  if (tolerance !== undefined) {
    options.tolerance = tolerance;
  }
  if (minPassRate !== undefined) {
    options.minPassRate = minPassRate;
  }
  if (minExecutableRate !== undefined) {
    options.minExecutableRate = minExecutableRate;
  }
  if (failOnDiagnosticRegression !== undefined) {
    options.failOnDiagnosticRegression = failOnDiagnosticRegression;
  }
  return options;
}

function datasetGovernanceOptions(args: Record<string, unknown>) {
  const options: {
    defaultSplit?: string;
  } = {};
  const defaultSplit = optionalString(args, "defaultSplit");
  if (defaultSplit !== undefined) {
    options.defaultSplit = defaultSplit;
  }
  return options;
}

function parseMode(args: Record<string, unknown>): Required<ParserValidationOptions>["mode"] {
  const mode = optionalString(args, "mode");
  if (mode === undefined || mode === "lint") {
    return "lint";
  }
  if (mode === "syntax") {
    return "syntax";
  }
  throw new Error("Expected 'mode' to be lint or syntax.");
}

function hasOwn(args: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
