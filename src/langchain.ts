import type { Diagnostic } from "./diagnostics.js";
import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import type { RepairAction, RepairOptions } from "./repair.js";
import { repairRawCypher } from "./repair.js";
import { createSafeExecutionPlan } from "./safety.js";
import { normalizeSchema, type NormalizedSchema } from "./schema.js";
import { type JsonSchema } from "./tools.js";

export interface LangChainCypherAdapterOptions extends RepairOptions {
  parserMode?: "lint" | "syntax";
  allowWrites?: boolean;
  approved?: boolean;
}

export interface LangChainCypherAdapterResult {
  source: "ir" | "raw";
  cypher: string;
  preflightCypher: string;
  params: Record<string, JsonLiteral>;
  canExecute: boolean;
  parserOk: boolean;
  requiresApproval: boolean;
  diagnostics: Diagnostic[];
  compilerDiagnostics: Diagnostic[];
  parserDiagnostics: Diagnostic[];
  repairs: RepairAction[];
  query?: CypherQuery;
  rawCypher?: string;
}

export interface LangChainToolLike {
  name: string;
  description: string;
  schema: JsonSchema;
  invoke(input: unknown): Promise<LangChainCypherAdapterResult>;
  call(input: unknown): Promise<LangChainCypherAdapterResult>;
  func(input: unknown): Promise<string>;
}

export interface LangChainCypherAdapter {
  compileQuery(query: CypherQuery, params?: Record<string, JsonLiteral>): Promise<LangChainCypherAdapterResult>;
  correctRawCypher(rawCypher: string, params?: Record<string, JsonLiteral>): Promise<LangChainCypherAdapterResult>;
  invoke(input: unknown): Promise<LangChainCypherAdapterResult>;
  asRunnable(): { invoke(input: unknown): Promise<LangChainCypherAdapterResult> };
  asTool(name?: string): LangChainToolLike;
}

export const LANGCHAIN_CYPHER_ADAPTER_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "object",
      description: "Structured CypherQuery IR. This path uses AST repair before rendering.",
      additionalProperties: true
    },
    rawCypher: {
      type: "string",
      description: "Legacy raw Cypher from a text2cypher chain. This path uses narrow migration repair plus parser validation."
    },
    params: {
      type: "object",
      description: "Cypher parameter values keyed by parameter name without the '$' prefix.",
      additionalProperties: true
    }
  }
};

export function createLangChainCypherAdapter(
  schemaInput: CypherSchemaContract | NormalizedSchema,
  options: LangChainCypherAdapterOptions = {}
): LangChainCypherAdapter {
  const schema = asNormalizedSchema(schemaInput);
  const parserMode = options.parserMode ?? "lint";

  async function compileQuery(
    query: CypherQuery,
    params: Record<string, JsonLiteral> = {}
  ): Promise<LangChainCypherAdapterResult> {
    const plan = createSafeExecutionPlan(query, schema, params, options);
    const parser = validateCypherTextWithParser(plan.cypher, schema, { mode: parserMode });
    return {
      source: "ir",
      cypher: plan.cypher,
      preflightCypher: plan.preflightCypher,
      params: plan.params,
      canExecute: plan.canExecute && parser.ok,
      parserOk: parser.ok,
      requiresApproval: plan.requiresApproval,
      diagnostics: [...plan.diagnostics, ...parser.diagnostics],
      compilerDiagnostics: plan.diagnostics,
      parserDiagnostics: parser.diagnostics,
      repairs: plan.repairs,
      query: plan.query
    };
  }

  async function correctRawCypher(
    rawCypher: string,
    params: Record<string, JsonLiteral> = {}
  ): Promise<LangChainCypherAdapterResult> {
    const repaired = repairRawCypher(rawCypher, schema);
    const parser = validateCypherTextWithParser(repaired.cypher, schema, { mode: parserMode });
    const canExecute = parser.ok && !repaired.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    return {
      source: "raw",
      cypher: repaired.cypher,
      preflightCypher: `EXPLAIN\n${repaired.cypher}`,
      params,
      canExecute,
      parserOk: parser.ok,
      requiresApproval: false,
      diagnostics: [...repaired.diagnostics, ...parser.diagnostics],
      compilerDiagnostics: repaired.diagnostics,
      parserDiagnostics: parser.diagnostics,
      repairs: repaired.applied,
      rawCypher
    };
  }

  async function invoke(input: unknown): Promise<LangChainCypherAdapterResult> {
    const args = adapterInput(input);
    if (isRecord(args.query)) {
      return compileQuery(args.query as unknown as CypherQuery, paramsInput(args.params));
    }
    if (typeof args.rawCypher === "string") {
      return correctRawCypher(args.rawCypher, paramsInput(args.params));
    }
    throw new Error("LangChain Cypher adapter requires either 'query' or 'rawCypher'.");
  }

  return {
    compileQuery,
    correctRawCypher,
    invoke,
    asRunnable: () => ({ invoke }),
    asTool: (name = "cypher_llm_compiler") => ({
      name,
      description:
        "Compile CypherQuery IR with AST repair and parser validation, or migrate legacy raw Cypher with narrow repair.",
      schema: LANGCHAIN_CYPHER_ADAPTER_INPUT_SCHEMA,
      invoke,
      call: invoke,
      func: async (input: unknown) => JSON.stringify(await invoke(input), null, 2)
    })
  };
}

function adapterInput(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("LangChain Cypher adapter JSON input must decode to an object.");
      }
      return parsed;
    }
    return { rawCypher: input };
  }
  if (!isRecord(input)) {
    throw new Error("LangChain Cypher adapter input must be an object, JSON string, or raw Cypher string.");
  }
  return input;
}

function paramsInput(input: unknown): Record<string, JsonLiteral> {
  if (input === undefined) {
    return {};
  }
  if (!isRecord(input)) {
    throw new Error("LangChain Cypher adapter 'params' must be an object.");
  }
  return input as Record<string, JsonLiteral>;
}

function asNormalizedSchema(schema: CypherSchemaContract | NormalizedSchema): NormalizedSchema {
  return "nodeByName" in schema ? schema : normalizeSchema(schema);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
