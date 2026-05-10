import type { Diagnostic } from "./diagnostics.js";
import type { CypherSchemaContract } from "./ir.js";
import { parseCypherLosslessly, type LosslessClauseNode, type LosslessParseOptions } from "./lossless-parser.js";

export type LosslessConformanceSource = "neo4j-example" | "opencypher-tck" | "gql-oriented" | "text2cypher";
export type LosslessConformanceStatus = "passed" | "warning" | "failed";
export type LosslessConformanceIrCoverage = "none" | "partial" | "full";

export interface LosslessConformanceCase {
  id: string;
  title: string;
  source: LosslessConformanceSource;
  dialect: string;
  cypher: string;
  tags: string[];
  schema?: CypherSchemaContract;
  parserMode?: LosslessParseOptions["parserMode"];
  requireParserOk?: boolean;
}

export interface LosslessConformanceReport {
  version: "cypher-llm-lossless-conformance/v1";
  generatedAt: string;
  summary: LosslessConformanceSummary;
  cases: LosslessConformanceCaseResult[];
}

export interface LosslessConformanceSummary {
  totalCases: number;
  passed: number;
  warnings: number;
  failed: number;
  roundTripPassed: number;
  parserPassed: number;
  parserWarnings: number;
  fullIrPreview: number;
  partialIrPreview: number;
  rawClauses: number;
  diagnosticsByCode: Record<string, number>;
  bySource: Record<LosslessConformanceSource, LosslessConformanceSourceSummary>;
}

export interface LosslessConformanceSourceSummary {
  cases: number;
  passed: number;
  warnings: number;
  failed: number;
}

export interface LosslessConformanceCaseResult {
  id: string;
  title: string;
  source: LosslessConformanceSource;
  dialect: string;
  status: LosslessConformanceStatus;
  cypherHash: string;
  bytes: number;
  roundTripOk: boolean;
  parserOk?: boolean;
  irCoverage: LosslessConformanceIrCoverage;
  supportedClauses: number;
  rawClauses: number;
  sourceMapEntries: number;
  clauses: LosslessConformanceClauseResult[];
  diagnostics: LosslessConformanceDiagnostic[];
}

export interface LosslessConformanceClauseResult {
  kind: string;
  keyword: string;
  support: LosslessClauseNode["support"];
  irPath?: string;
}

export interface LosslessConformanceDiagnostic {
  code: string;
  severity: Diagnostic["severity"];
  message: string;
}

const toolHashSchema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  dialect: "neo4j-cypher-25",
  nodes: [
    { name: "Tool", properties: { name: { type: "STRING" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [{ type: "has MD5 hash", from: "Tool", to: "Hash" }],
  parameters: {
    toolName: { type: "STRING", required: true }
  }
};

export const defaultLosslessConformanceCases: readonly LosslessConformanceCase[] = [
  {
    id: "neo4j-cypher25-parameterized-match",
    title: "Neo4j Cypher 25 Parameterized Read",
    source: "neo4j-example",
    dialect: "neo4j-cypher-25",
    cypher: "MATCH (tool:Tool {name: $toolName})-[:`has MD5 hash`]->(hash:Hash) RETURN hash.value AS md5 LIMIT 25",
    tags: ["match", "parameter", "escaped-relationship", "return-limit"],
    schema: toolHashSchema,
    requireParserOk: true
  },
  {
    id: "opencypher-tck-aggregation-with",
    title: "openCypher TCK-Style Aggregation",
    source: "opencypher-tck",
    dialect: "opencypher-9",
    cypher: "MATCH (tool:Tool) WITH count(tool) AS toolCount RETURN toolCount",
    tags: ["match", "with", "aggregation", "return"],
    schema: toolHashSchema,
    requireParserOk: true
  },
  {
    id: "gql-let-filter-preview",
    title: "GQL-Oriented LET And FILTER Preview",
    source: "gql-oriented",
    dialect: "gql",
    cypher: "MATCH (tool:Tool) LET toolName = tool.name FILTER toolName IS NOT NULL RETURN toolName",
    tags: ["match", "let", "filter", "gql-preview"],
    schema: toolHashSchema
  },
  {
    id: "text2cypher-unescaped-relationship",
    title: "text2cypher Unescaped Relationship Type",
    source: "text2cypher",
    dialect: "neo4j-cypher-25",
    cypher: "MATCH (tool:Tool)-[:has MD5 hash]->(hash:Hash) RETURN hash",
    tags: ["text2cypher", "raw-repair", "identifier-escaping"],
    schema: toolHashSchema
  }
] as const;

export function buildLosslessConformanceReport(
  cases: readonly LosslessConformanceCase[] = defaultLosslessConformanceCases
): LosslessConformanceReport {
  const results = cases.map(evaluateLosslessConformanceCase);
  return {
    version: "cypher-llm-lossless-conformance/v1",
    generatedAt: "2026-05-10",
    summary: summarize(results),
    cases: results
  };
}

function evaluateLosslessConformanceCase(testCase: LosslessConformanceCase): LosslessConformanceCaseResult {
  const report = parseCypherLosslessly(testCase.cypher, {
    ...(testCase.schema ? { schema: testCase.schema } : {}),
    parserMode: testCase.parserMode ?? "syntax"
  });
  const clauses = report.statements.flatMap((statement) => statement.clauses);
  const parserOk = report.parser?.ok;
  const supportedClauses = report.irPreview?.supportedClauses ?? 0;
  const rawClauses = report.irPreview?.rawClauses ?? clauses.filter((clause) => clause.support !== "lifted").length;
  const diagnostics = [
    ...report.diagnostics,
    ...(report.parser?.diagnostics ?? []),
    ...(report.irPreview?.diagnostics ?? [])
  ].map(toDiagnosticSummary);
  const irCoverage = classifyIrCoverage(clauses.length, supportedClauses, rawClauses);
  return {
    id: testCase.id,
    title: testCase.title,
    source: testCase.source,
    dialect: testCase.dialect,
    status: statusFor(testCase, report.roundTrip.ok, parserOk, rawClauses, diagnostics),
    cypherHash: report.sourceHash,
    bytes: report.roundTrip.bytes,
    roundTripOk: report.roundTrip.ok,
    ...(parserOk !== undefined ? { parserOk } : {}),
    irCoverage,
    supportedClauses,
    rawClauses,
    sourceMapEntries: report.sourceMap.length,
    clauses: clauses.map((clause) => ({
      kind: clause.kind,
      keyword: clause.keyword,
      support: clause.support,
      ...(clause.irPath ? { irPath: clause.irPath } : {})
    })),
    diagnostics
  };
}

function statusFor(
  testCase: LosslessConformanceCase,
  roundTripOk: boolean,
  parserOk: boolean | undefined,
  rawClauses: number,
  diagnostics: LosslessConformanceDiagnostic[]
): LosslessConformanceStatus {
  if (!roundTripOk || (testCase.requireParserOk === true && parserOk === false)) {
    return "failed";
  }
  if (parserOk === false || rawClauses > 0 || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "warning";
  }
  return "passed";
}

function classifyIrCoverage(
  totalClauses: number,
  supportedClauses: number,
  rawClauses: number
): LosslessConformanceIrCoverage {
  if (totalClauses === 0 || supportedClauses === 0) {
    return "none";
  }
  return rawClauses === 0 && supportedClauses === totalClauses ? "full" : "partial";
}

function summarize(results: LosslessConformanceCaseResult[]): LosslessConformanceSummary {
  const bySource = Object.fromEntries(
    (["neo4j-example", "opencypher-tck", "gql-oriented", "text2cypher"] as const).map((source) => {
      const sourceResults = results.filter((result) => result.source === source);
      return [source, sourceSummary(sourceResults)];
    })
  ) as Record<LosslessConformanceSource, LosslessConformanceSourceSummary>;
  return {
    totalCases: results.length,
    passed: results.filter((result) => result.status === "passed").length,
    warnings: results.filter((result) => result.status === "warning").length,
    failed: results.filter((result) => result.status === "failed").length,
    roundTripPassed: results.filter((result) => result.roundTripOk).length,
    parserPassed: results.filter((result) => result.parserOk === true).length,
    parserWarnings: results.filter((result) => result.parserOk === false).length,
    fullIrPreview: results.filter((result) => result.irCoverage === "full").length,
    partialIrPreview: results.filter((result) => result.irCoverage === "partial").length,
    rawClauses: results.reduce((sum, result) => sum + result.rawClauses, 0),
    diagnosticsByCode: diagnosticsByCode(results),
    bySource
  };
}

function sourceSummary(results: LosslessConformanceCaseResult[]): LosslessConformanceSourceSummary {
  return {
    cases: results.length,
    passed: results.filter((result) => result.status === "passed").length,
    warnings: results.filter((result) => result.status === "warning").length,
    failed: results.filter((result) => result.status === "failed").length
  };
}

function diagnosticsByCode(results: LosslessConformanceCaseResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const diagnostic of result.diagnostics) {
      counts[diagnostic.code] = (counts[diagnostic.code] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function toDiagnosticSummary(diagnostic: Diagnostic): LosslessConformanceDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message
  };
}
