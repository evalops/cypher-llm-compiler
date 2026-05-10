import { parse as parseCsv } from "csv-parse/sync";
import type { CypherSchemaContract, SchemaRelationship } from "./ir.js";
import type { EvalAttempt, EvalAttemptSet, EvalDataset, EvalOutcomeLabels, EvalTask } from "./evals.js";

export interface ImportOptions {
  datasetName: string;
  source: string;
  model?: string;
  prompt?: string;
  limit?: number;
  indexes?: number[];
}

export interface ImportedFixtureSet {
  dataset: EvalDataset;
  attempts: EvalAttemptSet;
  summary: ImportSummary;
}

export interface ImportSummary {
  source: string;
  totalInputRows: number;
  importedRows: number;
  syntaxErrorRows: number;
  timeoutRows: number;
  noCypherRows: number;
  returnsResultsRows: number;
  expectedAnswerRows: number;
}

interface Text2CypherCsvRow {
  question?: string;
  cypher?: string;
  type?: string;
  database?: string;
  explanation?: string;
  syntax_error?: string;
  timeout?: string;
  returns_results?: string;
  no_cypher?: string;
}

interface FunctionalCypherRow {
  Prompt?: string;
  Question?: string;
  Schema?: string;
  Cypher?: string;
}

export function importText2CypherCsv(csvText: string, options: ImportOptions): ImportedFixtureSet {
  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true
  }) as Text2CypherCsvRow[];
  const selected = selectRows(rows, options);
  const tasks: EvalTask[] = [];
  const attempts: EvalAttempt[] = [];

  selected.forEach(({ row, index }) => {
    const labels = labelsFromText2CypherRow(row);
    const taskIdValue = makeTaskId(options.datasetName, index, row.question ?? "text2cypher-row");
    const cypher = (row.cypher ?? "").trim();
    tasks.push({
      id: taskIdValue,
      question: row.question?.trim() || `Imported text2cypher row ${index}`,
      source: `${options.source}#row-${index}`,
      tags: compact(["text2cypher", row.type, row.database, ...labelsToTags(labels)]),
      schema: inferSchemaFromCypher(cypher),
      expected: {
        ...expectedDiagnosticsForLabels(labels),
        ...(labels.noCypher || labels.timeout || labels.syntaxError ? { canExecute: false } : {})
      }
    });

    attempts.push({
      taskId: taskIdValue,
      ...(options.model ? { model: options.model } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(labels.timeout
        ? { timeout: true }
        : labels.noCypher
          ? { noCypher: true }
          : { rawCypher: cypher || "NO CYPHER OUTPUT" }),
      observed: labels
    });
  });

  return {
    dataset: {
      version: "cypher-llm-eval-dataset/v1",
      name: options.datasetName,
      description: `Imported from ${options.source}. Rows preserve upstream syntax_error, timeout, returns_results, and no_cypher labels.`,
      tasks
    },
    attempts: {
      version: "cypher-llm-eval-attempts/v1",
      datasetName: options.datasetName,
      ...(options.model ? { model: options.model } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      attempts
    },
    summary: summarize(options.source, rows.length, attempts)
  };
}

export function importFunctionalCypherJson(jsonText: string, options: ImportOptions): ImportedFixtureSet {
  const rows = JSON.parse(jsonText) as FunctionalCypherRow[];
  const selected = selectRows(rows, options);
  const tasks: EvalTask[] = [];
  const attempts: EvalAttempt[] = [];

  selected.forEach(({ row, index }) => {
    const cypher = (row.Cypher ?? "").trim();
    const taskIdValue = makeTaskId(options.datasetName, index, row.Question ?? "functional-cypher-row");
    const keyword = firstKeyword(cypher);
    tasks.push({
      id: taskIdValue,
      question: row.Question?.trim() || `Imported functional Cypher row ${index}`,
      source: `${options.source}#row-${index}`,
      tags: compact(["text2cypher", "functional-cypher", "expected-answer"]),
      schema: schemaFromSchemaText(row.Schema, cypher),
      expected: {
        referenceCypher: cypher,
        ...(keyword ? { cypherContains: [keyword] } : {}),
        canExecute: true
      }
    });
    attempts.push({
      taskId: taskIdValue,
      ...(options.model ? { model: options.model } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      rawCypher: cypher,
      observed: {
        hasExpectedAnswer: true
      }
    });
  });

  return {
    dataset: {
      version: "cypher-llm-eval-dataset/v1",
      name: options.datasetName,
      description: `Imported from ${options.source}. Rows include reference Cypher as expected-answer fixtures.`,
      tasks
    },
    attempts: {
      version: "cypher-llm-eval-attempts/v1",
      datasetName: options.datasetName,
      ...(options.model ? { model: options.model } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      attempts
    },
    summary: summarize(options.source, rows.length, attempts)
  };
}

export function importOpenCypherTckFeature(featureText: string, options: ImportOptions): ImportedFixtureSet {
  const scenarios = parseTckScenarios(featureText);
  const selected = selectRows(scenarios, options);
  const tasks: EvalTask[] = [];
  const attempts: EvalAttempt[] = [];

  selected.forEach(({ row, index }) => {
    const taskIdValue = makeTaskId(options.datasetName, index, row.name);
    const keyword = firstKeyword(row.query);
    tasks.push({
      id: taskIdValue,
      question: row.name,
      source: `${options.source}#scenario-${index}`,
      tags: compact(["opencypher-tck", "syntax", row.featureName]),
      schema: inferSchemaFromCypher(row.query),
      expected: {
        referenceCypher: row.query,
        ...(keyword ? { cypherContains: [keyword] } : {}),
        canExecute: true
      }
    });
    attempts.push({
      taskId: taskIdValue,
      ...(options.model ? { model: options.model } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      rawCypher: row.query,
      observed: {
        hasExpectedAnswer: true
      }
    });
  });

  return {
    dataset: {
      version: "cypher-llm-eval-dataset/v1",
      name: options.datasetName,
      description: `Imported from ${options.source}. TCK queries are preserved as parser-backed syntax fixtures.`,
      tasks
    },
    attempts: {
      version: "cypher-llm-eval-attempts/v1",
      datasetName: options.datasetName,
      ...(options.model ? { model: options.model } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      attempts
    },
    summary: summarize(options.source, scenarios.length, attempts)
  };
}

export function inferSchemaFromCypher(cypher: string): CypherSchemaContract {
  const nodeLabels = new Set<string>();
  const relationships = new Map<string, SchemaRelationship>();
  const nodePattern = /\([^)]*:\s*(`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_]*)[^)]*\)/g;
  const relationshipPattern =
    /\([^)]*:\s*(`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_]*)[^)]*\)\s*<?-\[[^\]]*:\s*(`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_]*)[^\]]*\]-?>\s*\([^)]*:\s*(`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_]*)[^)]*\)/g;
  const looseRelationshipPattern = /\[[^\]]*:\s*(`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_]*)[^\]]*\]/g;

  for (const match of cypher.matchAll(nodePattern)) {
    nodeLabels.add(unquoteIdentifier(match[1] as string));
  }

  for (const match of cypher.matchAll(relationshipPattern)) {
    const from = unquoteIdentifier(match[1] as string);
    const type = unquoteIdentifier(match[2] as string);
    const to = unquoteIdentifier(match[3] as string);
    nodeLabels.add(from);
    nodeLabels.add(to);
    relationships.set(type, { type, from, to });
  }

  for (const match of cypher.matchAll(looseRelationshipPattern)) {
    const type = unquoteIdentifier(match[1] as string);
    if (!relationships.has(type)) {
      nodeLabels.add("Unknown");
      relationships.set(type, { type, from: "Unknown", to: "Unknown" });
    }
  }

  return {
    version: "cypher-llm-schema/v1",
    nodes: [...nodeLabels].sort().map((name) => ({ name })),
    relationships: [...relationships.values()].sort((left, right) => left.type.localeCompare(right.type))
  };
}

interface TckScenario {
  featureName: string;
  name: string;
  query: string;
}

function parseTckScenarios(featureText: string): TckScenario[] {
  const featureName = /^Feature:\s*(.+)$/m.exec(featureText)?.[1]?.trim() ?? "openCypher TCK feature";
  const scenarios: TckScenario[] = [];
  const scenarioBlocks = featureText.split(/\n\s*Scenario:/).slice(1);
  for (const block of scenarioBlocks) {
    const [nameLine = "", ...rest] = block.split("\n");
    const query = /When executing query:\s*\n\s*"""\s*\n([\s\S]*?)\n\s*"""/m.exec(rest.join("\n"))?.[1]?.trim();
    if (!query) {
      continue;
    }
    scenarios.push({
      featureName,
      name: nameLine.trim(),
      query
    });
  }
  return scenarios;
}

function schemaFromSchemaText(schemaText: string | undefined, cypher: string): CypherSchemaContract {
  if (!schemaText) {
    return inferSchemaFromCypher(cypher);
  }
  const labels = new Set<string>();
  for (const match of schemaText.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*(?:\{|$)/gm)) {
    labels.add(match[1] as string);
  }
  const inferred = inferSchemaFromCypher(cypher);
  for (const node of inferred.nodes) {
    labels.add(node.name);
  }
  return {
    ...inferred,
    nodes: [...labels].sort().map((name) => ({ name }))
  };
}

function labelsFromText2CypherRow(row: Text2CypherCsvRow): EvalOutcomeLabels {
  return {
    syntaxError: csvBoolean(row.syntax_error),
    timeout: csvBoolean(row.timeout),
    noCypher: csvBoolean(row.no_cypher),
    returnsResults: csvBoolean(row.returns_results),
    hasExpectedAnswer: false
  };
}

function expectedDiagnosticsForLabels(labels: EvalOutcomeLabels): { diagnosticCodes?: string[] } {
  const codes = compact([
    labels.syntaxError ? "cypher-parser-error" : undefined,
    labels.timeout ? "timeout" : undefined,
    labels.noCypher ? "no-cypher-output" : undefined
  ]);
  return codes.length > 0 ? { diagnosticCodes: codes } : {};
}

function summarize(source: string, totalInputRows: number, attempts: EvalAttempt[]): ImportSummary {
  return {
    source,
    totalInputRows,
    importedRows: attempts.length,
    syntaxErrorRows: attempts.filter((attempt) => attempt.observed?.syntaxError).length,
    timeoutRows: attempts.filter((attempt) => attempt.observed?.timeout).length,
    noCypherRows: attempts.filter((attempt) => attempt.observed?.noCypher).length,
    returnsResultsRows: attempts.filter((attempt) => attempt.observed?.returnsResults).length,
    expectedAnswerRows: attempts.filter((attempt) => attempt.observed?.hasExpectedAnswer).length
  };
}

function selectRows<T>(rows: T[], options: ImportOptions): Array<{ row: T; index: number }> {
  if (options.indexes && options.indexes.length > 0) {
    return options.indexes
      .filter((index) => index >= 0 && index < rows.length)
      .map((index) => ({ row: rows[index] as T, index }));
  }
  return rows.slice(0, options.limit ?? rows.length).map((row, index) => ({ row, index }));
}

function makeTaskId(datasetName: string, index: number, text: string): string {
  return `${slug(datasetName)}-${String(index).padStart(4, "0")}-${slug(text).slice(0, 48)}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "fixture";
}

function csvBoolean(value: string | undefined): boolean {
  return ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function labelsToTags(labels: EvalOutcomeLabels): string[] {
  return [
    labels.syntaxError ? "syntax-error" : undefined,
    labels.timeout ? "timeout" : undefined,
    labels.noCypher ? "no-cypher" : undefined,
    labels.returnsResults ? "returns-results" : "no-results"
  ].filter((tag): tag is string => typeof tag === "string");
}

function compact(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function unquoteIdentifier(value: string): string {
  return value.startsWith("`") && value.endsWith("`") ? value.slice(1, -1).replaceAll("``", "`") : value;
}

function firstKeyword(cypher: string): string | undefined {
  return /\b(MATCH|RETURN|WITH|CREATE|MERGE|CALL|UNWIND)\b/i.exec(cypher)?.[1]?.toUpperCase();
}
