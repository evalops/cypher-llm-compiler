import { lintCypherQuery, validateSyntax, type DbSchema, type SyntaxDiagnostic } from "@neo4j-cypher/language-support";
import type { CypherQuery, CypherSchemaContract } from "./ir.js";
import { diagnostic, hasErrors, type Diagnostic } from "./diagnostics.js";
import { renderQuery } from "./render.js";
import { cypherIdentifier, normalizeSchema, type NormalizedSchema } from "./schema.js";

export interface ParserValidationOptions {
  mode?: "syntax" | "lint";
}

export interface ParserValidationResult {
  ok: boolean;
  cypher: string;
  diagnostics: Diagnostic[];
  rawDiagnostics: SyntaxDiagnostic[];
}

export function validateRenderedQueryWithParser(
  query: CypherQuery,
  schemaInput: CypherSchemaContract | NormalizedSchema,
  options: ParserValidationOptions = {}
): ParserValidationResult {
  return validateCypherTextWithParser(renderQuery(query), schemaInput, options);
}

export function validateCypherTextWithParser(
  cypher: string,
  schemaInput: CypherSchemaContract | NormalizedSchema,
  options: ParserValidationOptions = {}
): ParserValidationResult {
  const schema = asNormalizedSchema(schemaInput);
  const dbSchema = dbSchemaFromContract(schema);
  const rawDiagnostics =
    options.mode === "syntax" ? validateSyntax(cypher, dbSchema) : lintCypherQuery(cypher, dbSchema);
  const diagnostics = rawDiagnostics.map((item) => mapParserDiagnostic(item));
  return {
    ok: !hasErrors(diagnostics),
    cypher,
    diagnostics,
    rawDiagnostics
  };
}

export function dbSchemaFromContract(schemaInput: CypherSchemaContract | NormalizedSchema): DbSchema {
  const schema = asNormalizedSchema(schemaInput);
  const labels = schema.nodes.flatMap((node) => identifierForms(node.name));
  const relationshipTypes = schema.relationships.flatMap((relationship) => identifierForms(relationship.type));
  const propertyKeys = [
    ...schema.nodes.flatMap((node) => Object.keys(node.properties ?? {})),
    ...schema.relationships.flatMap((relationship) => Object.keys(relationship.properties ?? {}))
  ].flatMap(identifierForms);
  const parameters = Object.fromEntries([...schema.parameters.keys()].map((name) => [name, true]));

  return {
    labels: unique(labels),
    relationshipTypes: unique(relationshipTypes),
    propertyKeys: unique(propertyKeys),
    parameters
  };
}

function mapParserDiagnostic(item: SyntaxDiagnostic): Diagnostic {
  const severity = item.severity === 1 ? "error" : item.severity === 2 ? "warning" : "info";
  const line = item.range.start.line + 1;
  const character = item.range.start.character + 1;
  return diagnostic({
    code: severity === "error" ? "cypher-parser-error" : "cypher-parser-warning",
    severity,
    message: item.message,
    path: `line:${line}:character:${character}`,
    suggestion:
      severity === "error"
        ? "Inspect the rendered Cypher at the reported position or send this diagnostic back to the model."
        : "Check whether the rendered query and schema contract are aligned."
  });
}

function identifierForms(name: string): string[] {
  return [name, cypherIdentifier(name)];
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function asNormalizedSchema(schema: CypherSchemaContract | NormalizedSchema): NormalizedSchema {
  return "nodeByName" in schema ? schema : normalizeSchema(schema);
}
