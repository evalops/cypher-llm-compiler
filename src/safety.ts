import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import { diagnostic, hasErrors, type Diagnostic } from "./diagnostics.js";
import { renderQuery } from "./render.js";
import { repairQuery, type RepairAction, type RepairOptions } from "./repair.js";
import { normalizeSchema, type NormalizedSchema } from "./schema.js";
import { isWriteClause, validateQuery } from "./validate.js";

export type ExecutionMode = "explain" | "readonly" | "write-requires-approval";

export interface SafeExecutionOptions extends RepairOptions {
  mode?: ExecutionMode;
  allowWrites?: boolean;
  approved?: boolean;
}

export interface SafeExecutionPlan {
  mode: ExecutionMode;
  cypher: string;
  preflightCypher: string;
  params: Record<string, JsonLiteral>;
  diagnostics: Diagnostic[];
  repairs: RepairAction[];
  requiresApproval: boolean;
  canExecute: boolean;
  query: CypherQuery;
}

export function createSafeExecutionPlan(
  query: CypherQuery,
  schemaInput: CypherSchemaContract | NormalizedSchema,
  params: Record<string, JsonLiteral> = {},
  options: SafeExecutionOptions = {}
): SafeExecutionPlan {
  const schema = asNormalizedSchema(schemaInput);
  const repair = repairQuery(query, schema, options);
  const validation = validateQuery(repair.query, schema, {
    disallowWrites: !(options.allowWrites ?? false)
  });
  const diagnostics = [...repair.diagnostics, ...validation.diagnostics];
  const writes = repair.query.clauses.some(isWriteClause);
  const requiresApproval = writes && !(options.allowWrites && options.approved);

  for (const [name, parameter] of schema.parameters) {
    if (parameter.required && !(name in params)) {
      diagnostics.push(
        diagnostic({
          code: "missing-required-parameter",
          severity: "error",
          message: `Required parameter '$${name}' was not provided.`,
          suggestion: "Provide a value for the required parameter before execution."
        })
      );
    }
  }

  if (requiresApproval) {
    diagnostics.push(
      diagnostic({
        code: "execution-approval-required",
        severity: "error",
        message: "This query contains writes and requires explicit approval before execution.",
        suggestion: "Set allowWrites and approved only after an external approval step."
      })
    );
  }

  const cypher = renderQuery(repair.query);
  const mode = writes ? "write-requires-approval" : options.mode ?? "explain";
  return {
    mode,
    cypher,
    preflightCypher: `EXPLAIN\n${cypher}`,
    params,
    diagnostics,
    repairs: repair.applied,
    requiresApproval,
    canExecute: !hasErrors(diagnostics),
    query: repair.query
  };
}

function asNormalizedSchema(schema: CypherSchemaContract | NormalizedSchema): NormalizedSchema {
  return "nodeByName" in schema ? schema : normalizeSchema(schema);
}
