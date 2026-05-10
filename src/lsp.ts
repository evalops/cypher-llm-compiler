import type { Diagnostic, DiagnosticSeverity, RepairHint } from "./diagnostics.js";
import type { CypherQuery, CypherSchemaContract } from "./ir.js";
import type { ParserValidationOptions } from "./parser-validation.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import { assessCypherPolicy, type CypherPolicyFinding } from "./policy.js";
import type { RepairAction, RepairOptions } from "./repair.js";
import { repairQuery, repairRawCypher } from "./repair.js";
import { renderQuery } from "./render.js";
import { validateQuery } from "./validate.js";

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4;

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: LspDiagnosticSeverity;
  code: string;
  source: "cypher-llm";
  message: string;
  data?: Record<string, unknown>;
}

export interface LspCodeAction {
  title: string;
  kind: "quickfix" | "refactor.rewrite" | "source.fixAll";
  diagnostics: LspDiagnostic[];
  data: Record<string, unknown>;
}

export interface LspDiagnosticReport {
  version: "cypher-llm-lsp-diagnostics/v1";
  uri: string;
  languageId: "cypher" | "cypher-ir";
  renderedCypher: string;
  diagnostics: LspDiagnostic[];
  codeActions: LspCodeAction[];
}

export interface LspDiagnosticOptions extends RepairOptions {
  uri?: string;
  parserMode?: ParserValidationOptions["mode"];
}

export function buildLspDiagnostics(
  input: { schema: CypherSchemaContract; query: CypherQuery; rawCypher?: never } | { schema: CypherSchemaContract; rawCypher: string; query?: never },
  options: LspDiagnosticOptions = {}
): LspDiagnosticReport {
  if ("query" in input) {
    return buildIrLspDiagnostics(input.schema, input.query, options);
  }
  return buildRawLspDiagnostics(input.schema, input.rawCypher, options);
}

function buildIrLspDiagnostics(
  schema: CypherSchemaContract,
  query: CypherQuery,
  options: LspDiagnosticOptions
): LspDiagnosticReport {
  const repaired = repairQuery(query, schema, options);
  const renderedCypher = renderQuery(repaired.query);
  const validation = validateQuery(repaired.query, schema);
  const parser = validateCypherTextWithParser(renderedCypher, schema, { mode: options.parserMode ?? "syntax" });
  const policy = assessCypherPolicy(repaired.query, schema);
  const diagnostics = uniqueDiagnostics([
    ...repaired.diagnostics.map((diagnostic) => lspDiagnostic(diagnostic)),
    ...validation.diagnostics.map((diagnostic) => lspDiagnostic(diagnostic)),
    ...parser.diagnostics.map((diagnostic) => lspDiagnostic(diagnostic)),
    ...policy.findings.map((finding) => lspDiagnostic(policyFindingAsDiagnostic(finding)))
  ]);

  return {
    version: "cypher-llm-lsp-diagnostics/v1",
    uri: options.uri ?? "cypher-ir://query.json",
    languageId: "cypher-ir",
    renderedCypher,
    diagnostics,
    codeActions: [
      ...diagnostics.flatMap((diagnostic) => codeActionsForDiagnostic(diagnostic)),
      ...repaired.applied.map((repair) => codeActionForAppliedRepair(repair))
    ],
  };
}

function buildRawLspDiagnostics(
  schema: CypherSchemaContract,
  rawCypher: string,
  options: LspDiagnosticOptions
): LspDiagnosticReport {
  const repaired = repairRawCypher(rawCypher, schema);
  const parser = validateCypherTextWithParser(repaired.cypher, schema, { mode: options.parserMode ?? "syntax" });
  const diagnostics = uniqueDiagnostics([
    ...repaired.diagnostics.map((diagnostic) => lspDiagnostic(diagnostic)),
    ...parser.diagnostics.map((diagnostic) => lspDiagnostic(diagnostic))
  ]);

  return {
    version: "cypher-llm-lsp-diagnostics/v1",
    uri: options.uri ?? "cypher://query.cypher",
    languageId: "cypher",
    renderedCypher: repaired.cypher,
    diagnostics,
    codeActions: [
      ...diagnostics.flatMap((diagnostic) => codeActionsForDiagnostic(diagnostic)),
      ...repaired.applied.map((repair) => codeActionForAppliedRepair(repair))
    ]
  };
}

function lspDiagnostic(diagnostic: Diagnostic): LspDiagnostic {
  return {
    range: rangeFromPath(diagnostic.path),
    severity: severity(diagnostic.severity),
    code: diagnostic.code,
    source: "cypher-llm",
    message: diagnostic.message,
    data: {
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
      ...(diagnostic.suggestion ? { suggestion: diagnostic.suggestion } : {}),
      ...(diagnostic.repair ? { repair: diagnostic.repair } : {})
    }
  };
}

function policyFindingAsDiagnostic(finding: CypherPolicyFinding): Diagnostic {
  return {
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    path: finding.path,
    suggestion: finding.suggestion
  };
}

function codeActionsForDiagnostic(diagnostic: LspDiagnostic): LspCodeAction[] {
  const repair = diagnostic.data?.repair as RepairHint | undefined;
  if (repair) {
    return [
      {
        title: `Apply compiler repair: ${repair.kind}`,
        kind: "quickfix",
        diagnostics: [diagnostic],
        data: {
          repairKind: repair.kind,
          description: repair.description,
          ...(repair.replacement !== undefined ? { replacement: repair.replacement } : {})
        }
      }
    ];
  }

  if (diagnostic.code === "policy-missing-limit" || diagnostic.code === "missing-limit") {
    return [
      {
        title: "Add a bounded LIMIT",
        kind: "quickfix",
        diagnostics: [diagnostic],
        data: { repairKind: "add-limit" }
      }
    ];
  }

  if (diagnostic.code === "policy-unbounded-traversal" || diagnostic.code === "unbounded-variable-length-path") {
    return [
      {
        title: "Bound variable-length traversal",
        kind: "quickfix",
        diagnostics: [diagnostic],
        data: { repairKind: "bound-path" }
      }
    ];
  }

  return [];
}

function codeActionForAppliedRepair(repair: RepairAction): LspCodeAction {
  return {
    title: `Preview compiler repair: ${repair.kind}`,
    kind: "refactor.rewrite",
    diagnostics: [],
    data: { repair }
  };
}

function severity(value: DiagnosticSeverity): LspDiagnosticSeverity {
  switch (value) {
    case "error":
      return 1;
    case "warning":
      return 2;
    case "info":
      return 3;
  }
}

function rangeFromPath(path: string | undefined): LspRange {
  const match = path?.match(/^line:(\d+):character:(\d+)$/);
  if (match) {
    const line = Math.max(0, Number(match[1]) - 1);
    const character = Math.max(0, Number(match[2]) - 1);
    return {
      start: { line, character },
      end: { line, character: character + 1 }
    };
  }
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  };
}

function uniqueDiagnostics(diagnostics: LspDiagnostic[]): LspDiagnostic[] {
  const seen = new Set<string>();
  const unique: LspDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}\0${diagnostic.message}\0${diagnostic.data?.path ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(diagnostic);
  }
  return unique;
}
