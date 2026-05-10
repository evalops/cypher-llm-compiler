export type DiagnosticCatalogSeverity = "error" | "warning" | "info" | "varies";
export type DiagnosticCatalogMatch = "exact" | "prefix" | "template";
export type DiagnosticCatalogSource =
  | "compiler-validation"
  | "parser-validation"
  | "raw-repair"
  | "raw-lift"
  | "lossless-parser"
  | "safe-execution"
  | "policy"
  | "neo4j-explain"
  | "dialect-certification"
  | "dataset-governance"
  | "eval-runner"
  | "http-service";
export type DiagnosticCatalogCategory =
  | "aggregation"
  | "benchmark"
  | "dataset"
  | "dialect"
  | "execution"
  | "policy"
  | "raw-compatibility"
  | "schema"
  | "scope"
  | "service"
  | "syntax"
  | "type";
export type DiagnosticCatalogAction =
  | "apply-deterministic-repair"
  | "ask-for-schema"
  | "block-release-or-request-review"
  | "fix-dataset"
  | "inspect-source"
  | "regenerate-ir"
  | "request-approval"
  | "retry-service"
  | "use-raw-migration";

export interface DiagnosticCatalogEntry {
  code: string;
  match: DiagnosticCatalogMatch;
  title: string;
  severity: DiagnosticCatalogSeverity;
  source: DiagnosticCatalogSource;
  category: DiagnosticCatalogCategory;
  preferredAction: DiagnosticCatalogAction;
  preferredTool?: string;
  description: string;
  modelInstruction: string;
  evidencePaths: string[];
  examplePaths?: string[];
}

export interface DiagnosticCatalog {
  version: "cypher-llm-diagnostic-catalog/v1";
  generatedAt: string;
  packageName: "@evalops/cypher-llm-compiler";
  packageVersion: string;
  entries: DiagnosticCatalogEntry[];
  summary: {
    entries: number;
    exactCodes: number;
    templates: number;
    errorOrVaries: number;
    warningOrInfo: number;
  };
}

export interface DiagnosticCatalogIntegrityReport {
  version: "cypher-llm-diagnostic-catalog-integrity/v1";
  ok: boolean;
  entries: number;
  diagnostics: string[];
}

const PACKAGE_VERSION = "0.1.0";

const entries: DiagnosticCatalogEntry[] = [
  validation("missing-return", "Missing RETURN", "warning", "syntax", "apply-deterministic-repair", "cypher_repair_plan", "Generated reads should project an explicit result."),
  validation("write-requires-approval", "Write Requires Approval", "error", "execution", "request-approval", "cypher_agent_feedback", "Write clauses are blocked unless an external approval path is supplied."),
  validation("raw-cypher-escape-hatch", "Raw Cypher Escape Hatch", "warning", "raw-compatibility", "use-raw-migration", "cypher_parse_lossless", "Raw clauses are allowed only as explicit migration escape hatches."),
  validation("raw-expression-escape-hatch", "Raw Expression Escape Hatch", "warning", "raw-compatibility", "use-raw-migration", "cypher_parse_lossless", "Raw expressions should be migrated to typed IR where possible."),
  validation("aggregate-in-match-where", "Aggregate In MATCH WHERE", "error", "aggregation", "regenerate-ir", "cypher_validate", "Aggregate predicates must move after WITH or RETURN."),
  validation("aggregate-alias-required", "Aggregate Alias Required", "error", "aggregation", "regenerate-ir", "cypher_validate", "Aggregate projections need stable aliases for later references."),
  validation("ambiguous-aggregation-expression", "Ambiguous Aggregation Expression", "error", "aggregation", "regenerate-ir", "cypher_validate", "Mixed aggregate and scalar projections need explicit grouping shape."),
  validation("invalid-aggregation", "Invalid Aggregation", "error", "aggregation", "regenerate-ir", "cypher_validate", "Aggregation expression shape is not valid for the target IR."),
  validation("missing-procedure", "Missing Procedure Metadata", "warning", "schema", "ask-for-schema", "cypher_validate", "Procedure calls need schema procedure metadata for full validation."),
  validation("unknown-procedure", "Unknown Procedure", "error", "schema", "ask-for-schema", "cypher_validate", "The procedure is not declared in the schema contract."),
  validation("unknown-procedure-yield", "Unknown Procedure YIELD", "error", "schema", "ask-for-schema", "cypher_validate", "The procedure YIELD variable is not declared in schema metadata."),
  validation("function-argument-mismatch", "Function Argument Mismatch", "error", "type", "regenerate-ir", "cypher_validate", "Function call arguments do not match declared arity or type metadata."),
  validation("procedure-argument-mismatch", "Procedure Argument Mismatch", "error", "type", "regenerate-ir", "cypher_validate", "Procedure call arguments do not match declared arity or type metadata."),
  validation("subquery-import-undefined", "Subquery Import Undefined", "error", "scope", "regenerate-ir", "cypher_repair_plan", "CALL subquery imports must reference variables in outer scope."),
  validation("subquery-missing-return", "Subquery Missing RETURN", "error", "scope", "regenerate-ir", "cypher_repair_plan", "CALL subqueries need explicit exported variables."),
  validation("subquery-variable-shadowing", "Subquery Variable Shadowing", "warning", "scope", "regenerate-ir", "cypher_repair_plan", "Subqueries should not accidentally shadow outer variables."),
  validation("missing-limit", "Missing LIMIT", "warning", "policy", "apply-deterministic-repair", "cypher_repair_plan", "Autonomous reads should add a bounded RETURN LIMIT."),
  validation("unknown-label", "Unknown Label", "error", "schema", "ask-for-schema", "cypher_validate", "The label is not declared in the schema contract."),
  validation("unknown-relationship-type", "Unknown Relationship Type", "error", "schema", "ask-for-schema", "cypher_validate", "The relationship type is not declared in the schema contract."),
  validation("unknown-property", "Unknown Property", "error", "schema", "ask-for-schema", "cypher_validate", "The property is not declared for the inferred node or relationship binding."),
  validation("unknown-parameter", "Unknown Parameter", "error", "schema", "ask-for-schema", "cypher_validate", "The parameter is not declared in the schema contract."),
  validation("undefined-variable", "Undefined Variable", "error", "scope", "regenerate-ir", "cypher_repair_plan", "Variables must be introduced before they are referenced."),
  validation("unbounded-variable-length-path", "Unbounded Variable-Length Path", "warning", "policy", "apply-deterministic-repair", "cypher_repair_plan", "Variable-length traversals should have a maximum hop count."),
  validation("relationship-direction-mismatch", "Relationship Direction Mismatch", "warning", "schema", "apply-deterministic-repair", "cypher_repair_plan", "Direction can be flipped only when schema endpoints make it unambiguous."),
  validation("dialect-rendering-limitation", "Dialect Rendering Limitation", "warning", "dialect", "use-raw-migration", "cypher_parse_lossless", "The renderer cannot yet express a supported dialect feature."),
  validation("dialect-unsupported-feature", "Dialect Unsupported Feature", "error", "dialect", "regenerate-ir", "cypher_validate", "The selected dialect profile does not support the requested feature."),
  validation("comparison-type-mismatch", "Comparison Type Mismatch", "error", "type", "regenerate-ir", "cypher_validate", "The compared expression types are incompatible."),
  validation("property-type-mismatch", "Property Type Mismatch", "error", "type", "regenerate-ir", "cypher_validate", "A property value does not match schema-declared type metadata."),
  validation("parameter-type-mismatch", "Parameter Type Mismatch", "error", "type", "regenerate-ir", "cypher_validate", "A parameter value does not match schema-declared type metadata."),
  parser("cypher-parser-error", "Parser Error", "error", "regenerate-ir", "cypher_parse_check", "Neo4j language-support rejected the rendered Cypher."),
  parser("cypher-parser-warning", "Parser Warning", "warning", "inspect-source", "cypher_parse_check", "Neo4j language-support emitted a non-blocking warning."),
  rawRepair("no-cypher-output", "No Cypher Output", "error", "regenerate-ir", "cypher_repair", "The model output does not look like Cypher."),
  rawRepair("sqlism-between", "SQL BETWEEN", "warning", "regenerate-ir", "cypher_repair", "The output used SQL BETWEEN syntax instead of Cypher comparisons."),
  rawRepair("raw-identifier-quoted", "Raw Identifier Quoted", "info", "apply-deterministic-repair", "cypher_repair", "Known schema identifiers were backtick-escaped."),
  rawLift("raw-lift-parser-diagnostic", "Raw Lift Parser Diagnostic", "varies", "use-raw-migration", "cypher_parse_lossless", "The lifted IR produced parser diagnostics."),
  rawLift("raw-lift-unsupported-clause", "Raw Lift Unsupported Clause", "warning", "use-raw-migration", "cypher_parse_lossless", "A raw clause is outside the raw-to-IR migration subset."),
  lossless("lossless-roundtrip-mismatch", "Lossless Roundtrip Mismatch", "error", "block-release-or-request-review", "cypher_parse_lossless", "Lossless fragments did not reconstruct the original source."),
  lossless("lossless-unterminated-token", "Lossless Unterminated Token", "error", "inspect-source", "cypher_parse_lossless", "Source contains an unterminated comment, quote, or identifier token."),
  lossless("lossless-unmatched-delimiter", "Lossless Unmatched Delimiter", "error", "inspect-source", "cypher_parse_lossless", "Source contains an unmatched or unclosed delimiter."),
  execution("missing-required-parameter", "Missing Required Parameter", "error", "ask-for-schema", "cypher_render", "A required Cypher parameter value was not supplied."),
  execution("execution-approval-required", "Execution Approval Required", "error", "request-approval", "cypher_agent_feedback", "A write query needs external approval before execution."),
  policy("policy-write-risk", "Write Risk", "error", "request-approval", "cypher_policy_check", "Policy blocked graph mutation without approval."),
  policy("policy-cartesian-pattern-risk", "Cartesian Pattern Risk", "warning", "regenerate-ir", "cypher_policy_check", "Disconnected MATCH patterns can create cartesian products."),
  policy("policy-unfiltered-label-scan", "Unfiltered Label Scan", "warning", "regenerate-ir", "cypher_policy_check", "A label scan has no anchoring predicate."),
  policy("policy-unfiltered-node-scan", "Unfiltered Node Scan", "warning", "regenerate-ir", "cypher_policy_check", "An unlabeled node scan has no anchoring predicate."),
  policy("policy-high-cardinality-label-scan", "High-Cardinality Label Scan", "warning", "regenerate-ir", "cypher_policy_check", "Schema statistics show a broad label scan."),
  policy("policy-unbounded-traversal", "Unbounded Traversal", "warning", "apply-deterministic-repair", "cypher_repair_plan", "Traversal is missing a maximum hop bound."),
  policy("policy-high-hop-traversal", "High-Hop Traversal", "warning", "apply-deterministic-repair", "cypher_repair_plan", "Traversal exceeds configured hop policy."),
  policy("policy-high-fanout-relationship", "High-Fanout Relationship", "warning", "regenerate-ir", "cypher_policy_check", "Schema statistics show high relationship fanout."),
  policy("policy-missing-limit", "Policy Missing LIMIT", "warning", "apply-deterministic-repair", "cypher_repair_plan", "Policy requires bounded RETURN output."),
  policy("policy-high-return-limit", "High RETURN LIMIT", "warning", "regenerate-ir", "cypher_policy_check", "RETURN LIMIT exceeds configured policy."),
  policy("policy-high-estimated-rows", "High Estimated Rows", "warning", "regenerate-ir", "cypher_policy_check", "Planner evidence estimates too many rows."),
  policy("policy-high-db-hits", "High DB Hits", "warning", "regenerate-ir", "cypher_policy_check", "Planner evidence estimates too many db hits."),
  policy("policy-expensive-plan-operator", "Expensive Plan Operator", "warning", "regenerate-ir", "cypher_policy_check", "Planner evidence includes an operator configured as risky."),
  policy("policy-planner-estimate-warning", "Planner Estimate Warning", "info", "inspect-source", "cypher_policy_check", "Planner evidence itself contains warnings."),
  policy("policy-unindexed-high-cardinality-predicate", "Unindexed High-Cardinality Predicate", "warning", "regenerate-ir", "cypher_policy_check", "A predicate on a high-cardinality label is not known to be indexed."),
  policy("policy-sensitive-label-access", "Sensitive Label Access", "varies", "request-approval", "cypher_policy_check", "Policy rules mark the label as sensitive."),
  policy("policy-missing-tenant-scope", "Missing Tenant Scope", "varies", "regenerate-ir", "cypher_policy_check", "Policy rules require tenant scoping predicates."),
  policy("policy-sensitive-relationship-access", "Sensitive Relationship Access", "varies", "request-approval", "cypher_policy_check", "Policy rules mark the relationship as sensitive."),
  policy("policy-sensitive-property-return", "Sensitive Property Return", "varies", "request-approval", "cypher_policy_check", "Policy rules mark the returned property as sensitive."),
  neo4j("neo4j-*", "Neo4j Server Error", "error", "regenerate-ir", "cypher_parse_check", "Neo4j rejected EXPLAIN or planning with a server error."),
  dataset("dataset-duplicate-task-id", "Duplicate Task ID", "error", "fix-dataset", "cypher_dataset_governance", "Dataset contains duplicate task ids."),
  dataset("dataset-missing-source", "Missing Dataset Source", "error", "fix-dataset", "cypher_dataset_governance", "Dataset task is missing provenance."),
  dataset("dataset-missing-split", "Missing Dataset Split", "warning", "fix-dataset", "cypher_dataset_governance", "Dataset task is missing a split tag."),
  dataset("possible-email", "Possible Email", "error", "fix-dataset", "cypher_dataset_governance", "Redaction scanner found an email-like value."),
  dataset("possible-secret", "Possible Secret", "error", "fix-dataset", "cypher_dataset_governance", "Redaction scanner found a secret-like value."),
  dataset("private-key", "Private Key", "error", "fix-dataset", "cypher_dataset_governance", "Redaction scanner found private-key material."),
  dataset("dataset-redaction-*", "Dataset Redaction Finding", "varies", "fix-dataset", "cypher_dataset_governance", "Dataset governance wraps redaction findings as blocking diagnostics."),
  evalRunner("missing-attempt", "Missing Eval Attempt", "error", "fix-dataset", "cypher_eval", "An eval task has no matching model attempt."),
  evalRunner("empty-attempt", "Empty Eval Attempt", "error", "fix-dataset", "cypher_eval", "A model attempt did not contain raw Cypher or structured IR."),
  service("internal-error", "Internal Error", "error", "retry-service", "http-service", "The HTTP service hit an unexpected error."),
  service("unauthorized", "Unauthorized", "error", "retry-service", "http-service", "The request missed required bearer authentication."),
  service("not-found", "Not Found", "error", "retry-service", "http-service", "The requested HTTP route is unknown."),
  service("method-not-allowed", "Method Not Allowed", "error", "retry-service", "http-service", "The route was called with the wrong HTTP method."),
  service("invalid-json-body", "Invalid JSON Body", "error", "retry-service", "http-service", "The service could not parse the request JSON body."),
  service("compiler-tool-error", "Compiler Tool Error", "error", "retry-service", "http-service", "The shared tool dispatcher rejected the request."),
  certification("profile-metadata-incomplete", "Profile Metadata Incomplete", "error", "block-release-or-request-review", "cypher-llm certify-dialects", "A dialect profile is missing required status, notes, or unsupported-pattern metadata."),
  certification("unescaped-schema-identifier", "Unescaped Schema Identifier", "error", "block-release-or-request-review", "cypher-llm certify-dialects", "Dialect certification found renderer output that failed to escape schema identifiers.")
];

export const diagnosticCatalog = {
  version: "cypher-llm-diagnostic-catalog/v1",
  generatedAt: "2026-05-10",
  packageName: "@evalops/cypher-llm-compiler",
  packageVersion: PACKAGE_VERSION,
  entries,
  summary: summarizeEntries(entries)
} as const satisfies DiagnosticCatalog;

export function buildDiagnosticCatalog(): DiagnosticCatalog {
  return JSON.parse(JSON.stringify(diagnosticCatalog)) as DiagnosticCatalog;
}

export function diagnosticCatalogIntegrityReport(catalog: DiagnosticCatalog = diagnosticCatalog): DiagnosticCatalogIntegrityReport {
  const diagnostics: string[] = [];
  const codes = new Set<string>();

  for (const entry of catalog.entries) {
    if (codes.has(entry.code)) {
      diagnostics.push(`duplicate diagnostic code ${entry.code}`);
    }
    codes.add(entry.code);
    if (entry.evidencePaths.length === 0) {
      diagnostics.push(`diagnostic ${entry.code} has no evidence paths`);
    }
    if (entry.modelInstruction.length === 0) {
      diagnostics.push(`diagnostic ${entry.code} has no model instruction`);
    }
    if (entry.match === "prefix" && !entry.code.endsWith("*")) {
      diagnostics.push(`prefix diagnostic ${entry.code} must end with *`);
    }
  }

  return {
    version: "cypher-llm-diagnostic-catalog-integrity/v1",
    ok: diagnostics.length === 0,
    entries: catalog.entries.length,
    diagnostics
  };
}

export function renderDiagnosticCatalogMarkdown(catalog: DiagnosticCatalog = diagnosticCatalog): string {
  const lines = [
    "# Diagnostic Catalog",
    "",
    `Package: ${catalog.packageName}@${catalog.packageVersion}`,
    "",
    "## Codes",
    ""
  ];

  for (const entry of catalog.entries) {
    lines.push(
      `- ${entry.code}: ${entry.severity} ${entry.category}`,
      `  Action: ${entry.preferredAction}${entry.preferredTool ? ` with ${entry.preferredTool}` : ""}`,
      `  Instruction: ${entry.modelInstruction}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function validation(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  category: DiagnosticCatalogCategory,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "compiler-validation", category, preferredAction, preferredTool, description, [
    "src/validate.ts",
    "test/compiler-loop.test.ts"
  ]);
}

function parser(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "parser-validation", "syntax", preferredAction, preferredTool, description, [
    "src/parser-validation.ts",
    "test/parser-validation.test.ts"
  ]);
}

function rawRepair(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "raw-repair", "raw-compatibility", preferredAction, preferredTool, description, [
    "src/repair.ts",
    "test/compiler-loop.test.ts"
  ]);
}

function rawLift(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "raw-lift", "raw-compatibility", preferredAction, preferredTool, description, [
    "src/raw-lift.ts",
    "test/raw-lift.test.ts"
  ]);
}

function lossless(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "lossless-parser", "raw-compatibility", preferredAction, preferredTool, description, [
    "src/lossless-parser.ts",
    "test/lossless-parser.test.ts"
  ]);
}

function execution(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "safe-execution", "execution", preferredAction, preferredTool, description, [
    "src/safety.ts",
    "test/safety.test.ts"
  ]);
}

function policy(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "policy", "policy", preferredAction, preferredTool, description, [
    "src/policy.ts",
    "test/policy.test.ts"
  ]);
}

function neo4j(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "prefix", title, severity, "neo4j-explain", "execution", preferredAction, preferredTool, description, [
    "src/neo4j-explain.ts",
    "test/neo4j-explain.test.ts"
  ]);
}

function certification(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "dialect-certification", "dialect", preferredAction, preferredTool, description, [
    "src/dialect-certification.ts",
    "test/dialect-certification.test.ts"
  ]);
}

function dataset(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(
    code,
    code.endsWith("*") ? "prefix" : "exact",
    title,
    severity,
    "dataset-governance",
    "dataset",
    preferredAction,
    preferredTool,
    description,
    ["src/dataset-governance.ts", "test/dataset-governance.test.ts"]
  );
}

function evalRunner(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "eval-runner", "benchmark", preferredAction, preferredTool, description, [
    "src/evals.ts",
    "test/evals.test.ts"
  ]);
}

function service(
  code: string,
  title: string,
  severity: DiagnosticCatalogSeverity,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string
): DiagnosticCatalogEntry {
  return entry(code, "exact", title, severity, "http-service", "service", preferredAction, preferredTool, description, [
    "src/http-server.ts",
    "test/http-server.test.ts"
  ]);
}

function entry(
  code: string,
  match: DiagnosticCatalogMatch,
  title: string,
  severity: DiagnosticCatalogSeverity,
  source: DiagnosticCatalogSource,
  category: DiagnosticCatalogCategory,
  preferredAction: DiagnosticCatalogAction,
  preferredTool: string,
  description: string,
  evidencePaths: string[]
): DiagnosticCatalogEntry {
  return {
    code,
    match,
    title,
    severity,
    source,
    category,
    preferredAction,
    preferredTool,
    description,
    modelInstruction: instruction(preferredAction, description),
    evidencePaths,
    examplePaths: ["examples/agent/agent-guide.json"]
  };
}

function instruction(action: DiagnosticCatalogAction, description: string): string {
  switch (action) {
    case "apply-deterministic-repair":
      return `${description} Apply deterministic compiler repair first, then re-run proof or agent feedback.`;
    case "ask-for-schema":
      return `${description} Ask for schema metadata or use declared aliases; do not invent graph names.`;
    case "block-release-or-request-review":
      return `${description} Treat this as a compiler or release blocker until reviewed.`;
    case "fix-dataset":
      return `${description} Fix benchmark data before publishing or using it as a gate.`;
    case "inspect-source":
      return `${description} Inspect the source span and keep the query in review if evidence is incomplete.`;
    case "regenerate-ir":
      return `${description} Regenerate the smallest affected IR subtree and preserve validated clauses.`;
    case "request-approval":
      return `${description} Stop before execution and request an explicit external approval path.`;
    case "retry-service":
      return `${description} Correct the request envelope or service auth before retrying.`;
    case "use-raw-migration":
      return `${description} Preserve source bytes and migrate toward structured IR only where supported.`;
  }
}

function summarizeEntries(values: readonly DiagnosticCatalogEntry[]): DiagnosticCatalog["summary"] {
  return {
    entries: values.length,
    exactCodes: values.filter((entry) => entry.match === "exact").length,
    templates: values.filter((entry) => entry.match !== "exact").length,
    errorOrVaries: values.filter((entry) => entry.severity === "error" || entry.severity === "varies").length,
    warningOrInfo: values.filter((entry) => entry.severity === "warning" || entry.severity === "info").length
  };
}
