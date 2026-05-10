import type { EvalAttemptSet, EvalDataset, EvalOptions, EvalReport } from "./evals.js";
import { evaluateAttempts } from "./evals.js";
import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import { buildLspDiagnostics } from "./lsp.js";
import { parseCypherLosslessly } from "./lossless-parser.js";
import type { ParserValidationOptions } from "./parser-validation.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import { assessCypherPolicy } from "./policy.js";
import { buildCypherProof } from "./proof.js";
import type { RepairOptions } from "./repair.js";
import { repairQuery, repairRawCypher } from "./repair.js";
import { renderQuery } from "./render.js";
import type { SafeExecutionOptions } from "./safety.js";
import { createSafeExecutionPlan } from "./safety.js";
import { buildCypherBenchScorecard } from "./scorecard.js";
import type { ValidationOptions } from "./validate.js";
import { validateQuery } from "./validate.js";

export type JsonSchema = Record<string, unknown>;

export type CypherCompilerToolName =
  | "cypher_render"
  | "cypher_validate"
  | "cypher_repair"
  | "cypher_parse_lossless"
  | "cypher_parse_check"
  | "cypher_policy_check"
  | "cypher_lsp_diagnostics"
  | "cypher_prove"
  | "cypher_eval"
  | "cypher_scorecard";

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
      "Repair Cypher. Structured IR gets deterministic AST repairs; raw Cypher gets narrow migration repairs and diagnostics.",
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
    name: "cypher_parse_lossless",
    description:
      "Parse raw Cypher into a lossless concrete syntax report with exact round-trip fragments, comments, source spans, parser diagnostics, and an IR preview when supported.",
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
      }
    })
  },
  {
    name: "cypher_lsp_diagnostics",
    description:
      "Build LSP-style diagnostics and code actions for structured Cypher IR or raw Cypher using compiler, parser, policy, and repair outputs.",
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
    parserMode?: ParserValidationOptions["mode"];
    includeParser?: boolean;
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
  return options;
}

function policyOptions(args: Record<string, unknown>) {
  const options: {
    allowWrites?: boolean;
    requireLimit?: boolean;
    maxReturnLimit?: number;
    maxRelationshipHops?: number;
  } = {};
  const allowWrites = optionalBoolean(args, "allowWrites");
  const requireLimit = optionalBoolean(args, "requireLimit");
  const maxReturnLimit = optionalNumber(args, "maxReturnLimit");
  const maxRelationshipHops = optionalNumber(args, "maxRelationshipHops");
  if (allowWrites !== undefined) {
    options.allowWrites = allowWrites;
  }
  if (requireLimit !== undefined) {
    options.requireLimit = requireLimit;
  }
  if (maxReturnLimit !== undefined) {
    options.maxReturnLimit = maxReturnLimit;
  }
  if (maxRelationshipHops !== undefined) {
    options.maxRelationshipHops = maxRelationshipHops;
  }
  return options;
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
