import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import { diagnostic, hasErrors, type Diagnostic } from "./diagnostics.js";
import { buildPlannerEstimateFromNeo4jSummary, type CypherPlannerEstimate } from "./planner-estimate.js";
import { createSafeExecutionPlan, type SafeExecutionOptions, type SafeExecutionPlan } from "./safety.js";
import { normalizeSchema, type NormalizedSchema } from "./schema.js";

export interface Neo4jRunResultLike {
  records?: unknown[];
  summary?: unknown;
}

export interface Neo4jTransactionLike {
  run(cypher: string, params?: Record<string, JsonLiteral>): Promise<Neo4jRunResultLike>;
}

export interface Neo4jSessionLike {
  run(cypher: string, params?: Record<string, JsonLiteral>): Promise<Neo4jRunResultLike>;
  executeRead?<T>(work: (tx: Neo4jTransactionLike) => Promise<T>): Promise<T>;
}

export interface Neo4jExplainOptions extends SafeExecutionOptions {
  useExecuteRead?: boolean;
}

export interface Neo4jExplainResult {
  ok: boolean;
  executed: boolean;
  plan: SafeExecutionPlan;
  diagnostics: Diagnostic[];
  plannerEstimate?: CypherPlannerEstimate;
  summary?: unknown;
  records?: unknown[];
}

export async function explainWithNeo4j(
  query: CypherQuery,
  schemaInput: CypherSchemaContract | NormalizedSchema,
  session: Neo4jSessionLike,
  params: Record<string, JsonLiteral> = {},
  options: Neo4jExplainOptions = {}
): Promise<Neo4jExplainResult> {
  const schema = "nodeByName" in schemaInput ? schemaInput : normalizeSchema(schemaInput);
  const plan = createSafeExecutionPlan(query, schema, params, { ...options, mode: "explain" });
  const diagnostics = [...plan.diagnostics];

  if (!plan.canExecute) {
    return {
      ok: false,
      executed: false,
      plan,
      diagnostics
    };
  }

  try {
    const result =
      options.useExecuteRead !== false && session.executeRead
        ? await session.executeRead((tx) => tx.run(plan.preflightCypher, params))
        : await session.run(plan.preflightCypher, params);
    const plannerEstimate = result.summary !== undefined
      ? buildPlannerEstimateFromNeo4jSummary(result.summary, "neo4j-explain")
      : undefined;
    return {
      ok: !hasErrors(diagnostics),
      executed: true,
      plan,
      diagnostics,
      ...(plannerEstimate !== undefined ? { plannerEstimate } : {}),
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
      ...(result.records !== undefined ? { records: result.records } : {})
    };
  } catch (error) {
    diagnostics.push(neo4jErrorDiagnostic(error));
    return {
      ok: false,
      executed: true,
      plan,
      diagnostics
    };
  }
}

export function neo4jErrorDiagnostic(error: unknown): Diagnostic {
  const maybe = error as { code?: unknown; message?: unknown };
  const code = typeof maybe.code === "string" && maybe.code.length > 0 ? maybe.code : "Neo4j.ClientError.Statement.Unknown";
  const message = typeof maybe.message === "string" && maybe.message.length > 0 ? maybe.message : String(error);
  return diagnostic({
    code: `neo4j-${code}`,
    severity: "error",
    message,
    suggestion: "Map this server error back into the LLM repair loop with the rendered Cypher and schema contract."
  });
}
