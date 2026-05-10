# API Reference

## `normalizeSchema(schema)`

Builds lookup maps for labels, relationship types, aliases, properties, parameters, and escaped identifier metadata.

Use it once per graph schema and pass the normalized schema into validation, repair, and safety planning.

## `renderQuery(query, options?)`

Renders a `CypherQuery` into deterministic Cypher text.

Defaults:

- Schema identifiers are always backtick escaped.
- Map and property entries are sorted.
- Binary expressions are parenthesized.
- Clauses are separated by newlines.

## `renderQueryForDialect(query, dialect, options?)`

Renders with the checked-in dialect profile's rendering rules, currently identifier escaping. Validation reports dialect limitations that the renderer cannot yet express, such as GQL relationship quantifier output.

## `validateQuery(query, schema, options?)`

Returns:

```ts
{
  ok: boolean;
  diagnostics: Diagnostic[];
}
```

Validation currently covers:

- Unknown labels and relationship types.
- Unknown properties when variable ownership can be inferred.
- Unknown parameters.
- Variables referenced out of scope.
- Aggregate functions in pre-aggregation `MATCH WHERE` clauses.
- Aggregate projections that need stable aliases for later clauses.
- Aggregate calls repeated in post-projection predicates instead of referenced by alias.
- Ambiguous aggregate/scalar projection expressions.
- `CALL {}` subquery imports, exports, and outer-scope shadowing.
- Procedure names and `YIELD` variables when `schema.procedures` metadata is provided.
- Procedure argument count and type checks when `schema.procedures` metadata is provided.
- Function argument count and type checks for built-ins and `schema.functions` metadata.
- Property, parameter, and comparison type mismatches.
- Dialect feature checks for core Neo4j Cypher 25, openCypher 9, and GQL-oriented profile flags.
- Relationship direction against declared endpoints.
- Missing `LIMIT` in LLM-safe read mode.
- Unbounded variable-length paths.
- Raw Cypher escape hatches.
- Write clauses in read-only mode.

## `repairQuery(query, schema, options?)`

Applies deterministic repairs over the structured IR:

- Canonicalize label and relationship aliases.
- Add a default `LIMIT`.
- Bound unbounded paths with `defaultMaxHops`.
- Flip relationship direction when schema endpoints make the repair unambiguous.

It returns the repaired query, diagnostics, and an ordered list of applied repairs.

## `buildCypherRepairPlan(query, schema, options?)`

Builds a `cypher-llm-repair-plan/v1` object that separates:

- `deterministic`: compiler-owned JSON-patch-like steps for canonicalization, direction, path bounds, and limits.
- `modelRequired`: diagnostics that require corrected `CypherQuery` IR from a model.
- `unsafe`: approval-gated or policy-blocked steps that should not be auto-repaired.

The report includes `cypherBefore`, `cypherAfter`, ranked steps, diagnostics, and a compact summary.

When supplied, `plannerEstimate`, `schemaStatistics`, policy thresholds, and `policyRules` feed the same policy engine used by `assessCypherPolicy`; blocking policy-rule diagnostics are placed in `unsafe` rather than treated as model-editable repairs. The output includes `policyEvidence` with `ok`, summary counts, stable finding codes, and any rule, planner, or statistics summaries used by the decision.

## `repairRawCypher(raw, schema)`

Bootstrap bridge for existing text2cypher chains.

It intentionally does only narrow repairs:

- Quote known schema identifiers that require backticks.
- Flag SQL `BETWEEN`.
- Flag output that does not look like Cypher.

Use this to migrate legacy chains, not as the primary authoring path.

## `liftRawCypherToIr(raw, schema?, options?)`

Converts common raw read-query shapes into `CypherQuery` IR and renders the lifted query.

Supported shapes include `MATCH`, `OPTIONAL MATCH`, `WHERE`, `WITH`, `RETURN`, `ORDER BY`, `SKIP`, `LIMIT`, and simple procedure `CALL ... YIELD ...` clauses. Unsupported clauses are preserved as explicit raw clauses and reported with `raw-lift-unsupported-clause`.

When `schema` is supplied, the function validates the lifted rendered Cypher with Neo4j language support and sets `parserOk`.

## `parseCypherLosslessly(source, options?)`

Produces a `cypher-llm-lossless-parse/v1` report for existing Cypher text without changing the source bytes.

The report includes:

- Exact source fragments that reconstruct the original text.
- Statement and clause nodes with source spans.
- Preserved line and block comments.
- Delimiter and unterminated-token diagnostics.
- Optional Neo4j language-support parser validation when `schema` is supplied.
- A best-effort IR preview for the supported single-statement subset, with source clauses mapped to `/clauses/{index}` paths where lifting succeeds.

Use `roundTripLosslessParse(report)` to reconstruct the source from report fragments, or inspect `roundTrip.ok` and `sourceHash` in serialized reports.

## `evaluateRawLiftAttempts(dataset, attempts)`

Runs `liftRawCypherToIr` over raw attempts in an eval attempt file and returns `cypher-llm-raw-lift-eval/v1`.

The report includes raw attempt count, fully lifted count, partially lifted count, unsupported count, diagnostic counts, and rendered Cypher per task.

## `normalizeQuery(query)`

Renders canonical text for eval comparison. This is useful for golden tests where free-form whitespace and property ordering should not create false negatives.

## `equivalentQueries(left, right)`

Compares canonical render output.

## `createSafeExecutionPlan(query, schema, params?, options?)`

Produces a `SafeExecutionPlan`:

```ts
{
  mode: "explain" | "readonly" | "write-requires-approval";
  cypher: string;
  preflightCypher: string;
  params: Record<string, JsonLiteral>;
  diagnostics: Diagnostic[];
  repairs: RepairAction[];
  requiresApproval: boolean;
  canExecute: boolean;
  query: CypherQuery;
}
```

No database is touched. A real adapter can run `preflightCypher`, then use `canExecute` and `requiresApproval` to decide what to do next.

## `buildCypherProof(query, schema, params?, options?)`

Produces a `cypher-llm-proof/v1` object for agent feedback loops:

```ts
{
  status: "accepted" | "accepted-with-warnings" | "repaired" | "blocked";
  cypher: string;
  preflightCypher: string;
  canExecute: boolean;
  requiresApproval: boolean;
  repairKinds: string[];
  diagnosticCodes: string[];
  policyEvidence: CypherPolicyEvidence;
  claims: CypherProofClaim[];
}
```

Proof claims cover deterministic repairs, compiler diagnostics, execution policy, static cost/safety policy, and parser preflight unless `includeParser` is false. `plannerEstimate`, `schemaStatistics`, policy thresholds, and `policyRules` can be passed into proof options so the cost/safety claim reflects the same evidence used by policy checks. Proofs also include `policyEvidence` so an agent can explain the policy status without issuing a separate policy-check call.

## `buildCypherAgentFeedback(query, schema, params?, options?)`

Produces a `cypher-llm-agent-feedback/v1` packet for agent runtimes that want one decision object instead of separate proof and repair-plan calls.

The packet includes:

- `proof`: the full `cypher-llm-proof/v1` object.
- `repairPlan`: the full `cypher-llm-repair-plan/v1` object.
- `policyEvidence`: compact policy status and finding-code summary.
- `nextAction`: one of `execute`, `apply-deterministic-repairs`, `regenerate-query`, `request-approval`, or `blocked`.

## `buildAgentGuide()`

Produces a `cypher-llm-agent-guide/v1` object for LLM clients and agent runtimes.

The guide includes:

- Contract principles and default authoring rules.
- Tool workflows for read authoring, repair, policy-safe autonomy, raw migration, and release compatibility.
- Diagnostic playbooks that map stable codes to preferred actions and tools.
- Public contract and example paths agents should pin.

## `buildDiagnosticCatalog()`

Produces a `cypher-llm-diagnostic-catalog/v1` object for LLM clients and release governance.

The catalog includes:

- Stable diagnostic codes and code-prefix families.
- Severity, source, category, preferred action, and preferred tool metadata.
- Model instructions for repair loops.
- Evidence paths used to keep diagnostic code ownership visible.

## `buildCompatibilityCatalog()`

Produces a `cypher-llm-compatibility-catalog/v1` object for governance and release automation.

The catalog includes:

- Compatibility levels: `stable`, `preview`, and `experimental`.
- Public contract entries with category, owner workstream, schema path, examples, evidence, breaking-change policy, and deprecation policy.
- Release gates and certification gates with concrete commands.
- A shared deprecation policy for stable and preview contracts.

## `buildCompatibilityDiffReport(baseline, candidate?)`

Produces a `cypher-llm-compatibility-diff/v1` report for release automation.

The report includes:

- Baseline and candidate catalog summaries.
- Added, removed, and changed contracts.
- Release-gate and certification-gate changes.
- Deprecation-policy changes.
- A pass/fail status based on breaking changes.

## `assessCypherPolicy(query, schema, options?)`

Produces a `cypher-llm-policy-report/v1` object for static cost, cardinality, and safety checks.

Current findings include:

- Broad label or node scans without an anchoring predicate.
- Multiple `MATCH` patterns that may create cartesian products.
- Missing or high literal `RETURN LIMIT` values.
- Unbounded or high-hop variable-length traversals.
- Planner-estimated rows, db hits, and expensive plan operators when `plannerEstimate` is supplied.
- High-cardinality label scans, unindexed predicates, and high-fanout relationships when `schemaStatistics` is supplied.
- Sensitive label/relationship access, sensitive returned properties, and missing tenant-scope predicates when `policyRules` is supplied.
- Write clauses without an explicit policy allowance.

Pass `policyOptionsFromProfile(getPolicyProfile("llm-readonly-strict"))` to apply a named profile and record that policy identity in the report.

## `buildPlannerEstimateFromNeo4jSummary(summary, source?)`

Extracts a `cypher-llm-planner-estimate/v1` object from a Neo4j-like `summary.plan` or `summary.profile` tree.

The estimate captures planner source, max estimated rows, summed db hits when available, and nested operator names/identifiers. Pass the result to `assessCypherPolicy` as `plannerEstimate` to turn planner evidence into stable policy findings.

## `buildSchemaStatisticsSkeleton(schema, source?)`

Produces a `cypher-llm-schema-statistics/v1` skeleton from a schema contract. Applications can fill in node counts, indexed properties, relationship counts, and average fanout from database metadata or offline catalog jobs.

Pass the completed statistics object to `assessCypherPolicy` as `schemaStatistics` to flag high-cardinality label scans, predicates on non-indexed properties, and high-fanout relationship traversals.

## `CypherPolicyRuleSet`

`cypher-llm-policy-rules/v1` objects let applications supply tenant and sensitive-data policy rules at runtime. Rules can mark labels, relationship types, and returned properties as sensitive, and can require a label to be constrained by a property or parameter such as `tenantId`.

Pass the rule set to `assessCypherPolicy` as `policyRules`, or to the CLI with `--policy-rules`, to include stable policy findings and a compact rule summary in `cypher-llm-policy-report/v1`. The same rule set can also be supplied to proof and repair-plan calls so agents receive blocked proof claims or unsafe repair-plan steps.

## `buildPolicyProfileCatalog()`

Produces a `cypher-llm-policy-profile-catalog/v1` catalog of built-in policy profiles.

Use `getPolicyProfile(id)` to load a built-in profile and `policyOptionsFromProfile(profile, overrides?)` to turn it into `assessCypherPolicy` options. The built-in profiles are:

- `llm-readonly-strict`
- `llm-readonly-exploration`
- `approved-write-maintenance`

## `buildLspDiagnostics(input, options?)`

Produces a `cypher-llm-lsp-diagnostics/v1` report with LSP-shaped diagnostics and code actions for either structured IR or raw Cypher migration input.

The report includes:

- `uri` and `languageId`.
- Rendered Cypher preview.
- LSP-style diagnostics with ranges, severity numbers, codes, source, message, and data.
- Quick fixes for repairable diagnostics and preview actions for deterministic compiler repairs.

## `validateRenderedQueryWithParser(query, schema, options?)`

Renders a structured query and validates the resulting Cypher with Neo4j's `@neo4j-cypher/language-support` package.

Modes:

- `lint`: parser plus language-support linting.
- `syntax`: parser syntax diagnostics only.

The adapter maps Neo4j language-support diagnostics back into this package's stable `Diagnostic` shape.

## `validateCypherTextWithParser(cypher, schema, options?)`

Runs parser-backed validation directly on raw Cypher text. This is useful for migration from legacy text2cypher chains.

## `dbSchemaFromContract(schema)`

Converts a `CypherSchemaContract` into the `DbSchema` object expected by Neo4j language support. It includes both canonical and backtick-escaped identifier forms so rendered LLM-safe Cypher does not produce false missing-label warnings.

## `explainWithNeo4j(query, schema, session, params?, options?)`

Runs the compiler loop and then executes `EXPLAIN` through a Neo4j driver-compatible session.

The adapter accepts a small session interface rather than importing `neo4j-driver` directly:

```ts
{
  run(cypher, params): Promise<{ records?: unknown[]; summary?: unknown }>;
  executeRead?(work): Promise<unknown>;
}
```

Behavior:

- Builds a `SafeExecutionPlan`.
- Refuses to contact Neo4j when compiler diagnostics already block execution.
- Runs `EXPLAIN` with params when the plan is executable.
- Extracts a `cypher-llm-planner-estimate/v1` object from the returned summary when a plan tree is available.
- Maps thrown Neo4j driver errors back into stable `Diagnostic` objects.

This lets applications bring their own driver/session lifecycle while the compiler owns preflight behavior.

The repo includes an optional live fixture in `test/neo4j-live.test.ts`. Set `CYPHER_LLM_NEO4J_URI` and `CYPHER_LLM_NEO4J_PASSWORD`, or use `docker-compose.neo4j.yml`; see `docs/NEO4J_LIVE_FIXTURE.md`.

## `introspectNeo4jSchema(session, options?)`

Builds a `CypherSchemaContract` from a live Neo4j database using a driver-compatible session.

It discovers labels, relationship types, properties, observed relationship endpoints, and procedure yielded variables. The CLI equivalent is:

```bash
cypher-llm introspect-neo4j --uri bolt://localhost:7687 --user neo4j --password "$NEO4J_PASSWORD"
```

See `docs/NEO4J_INTROSPECTION.md` for sampling and redaction notes.

## `evaluateFailureCorpus(cases?)`

Runs the known LLM failure fixtures and returns pass/fail records with canonical Cypher and diagnostic codes.

## `evaluateAttempts(dataset, attemptSet, options?)`

Scores an offline eval dataset against a set of model attempts.

Inputs:

- `EvalDataset`: task id, natural-language question, schema contract, optional params, and expectations.
- `EvalAttemptSet`: per-task model output as either structured IR or raw Cypher.

Output:

```ts
{
  version: "cypher-llm-eval-report/v1";
  datasetName: string;
  metrics: {
    totalTasks: number;
    passedTasks: number;
    passRate: number;
    executableRate: number;
    repairRate: number;
    diagnosticsByCode: Record<string, number>;
  };
  results: EvalResult[];
}
```

This is the main entrypoint for comparing raw text2cypher against compiler-mediated generation.

## `compareEvalReports(baseline, candidate, options?)`

Compares two `EvalReport` objects and returns `cypher-llm-eval-comparison/v1` with metric deltas, diagnostic deltas, improvements, and regressions.

This backs the `cypher-llm compare-evals` CLI command and can be used as a CI regression gate.

## `buildCypherBenchScorecard(reports, options?)`

Builds a `cypher-llm-cypherbench-scorecard/v1` report from one or more eval reports.

The scorecard includes:

- Ranked benchmark lanes.
- Baseline comparisons against the first report or `baselineIndex`.
- Aggregate diagnostic counts by lane.
- Best pass and executable rates.
- A summary status of `improved`, `regressed`, or `unchanged`.

Use `renderCypherBenchScorecardMarkdown(scorecard)` to publish the same report as a compact markdown table.

## `buildDatasetGovernanceReport(dataset, options?)`

Builds a `cypher-llm-dataset-governance/v1` report for an eval dataset.

The report includes:

- Task-level provenance source and inferred license.
- Split assignment from `split:*` tags.
- Missing source and missing split diagnostics.
- Duplicate task-id diagnostics.
- Redaction findings for email, secret-looking token, and private-key patterns.
- Aggregated source, split, redaction, and diagnostic summaries.

Use this before publishing or refreshing benchmark datasets so dataset governance is testable instead of only documented in prose.

## `evaluateRepairLoop(dataset, attempts, options?)`

Runs `evaluateAttempts` and emits `cypher-llm-repair-loop/v1` feedback packets for attempts with diagnostics, execution failures, or failed expectations.

Each packet contains the task question, task schema, rendered attempt when available, diagnostic retry hints, failed expectations, and a concise instruction asking for corrected `CypherQuery` IR.

## `getOpenAiResponsesTools()`

Returns OpenAI Responses API function-tool definitions for:

- `cypher_render`
- `cypher_validate`
- `cypher_repair`
- `cypher_repair_plan`
- `cypher_parse_lossless`
- `cypher_parse_check`
- `cypher_policy_check`
- `cypher_policy_profiles`
- `cypher_lsp_diagnostics`
- `cypher_prove`
- `cypher_agent_feedback`
- `cypher_agent_guide`
- `cypher_diagnostic_catalog`
- `cypher_compatibility_catalog`
- `cypher_compatibility_diff`
- `cypher_eval`
- `cypher_scorecard`
- `cypher_benchmark_gate`
- `cypher_dataset_governance`

## `getOpenAiChatTools()`

Returns the same operations in the chat-completions `{ type: "function", function: ... }` shape.

## `executeCypherCompilerTool(name, input)`

Runs one of the exported tool operations using the same implementation that backs MCP:

```ts
const output = await executeCypherCompilerTool("cypher_render", {
  schema,
  query,
  defaultLimit: 25,
  defaultMaxHops: 5
});
```

## `runMcpServer(input?, output?)`

Starts a stdio MCP server that supports `initialize`, `ping`, `tools/list`, and `tools/call`.

The package also exposes a `cypher-llm-mcp` binary and `cypher-llm mcp` CLI command.

## `createCompilerHttpServer(options?)`

Starts a JSON HTTP service over the same compiler tool dispatcher.

Routes:

- `GET /healthz`
- `GET /v1/service-manifest`
- `GET /v1/tools`
- `POST /v1/render`
- `POST /v1/validate`
- `POST /v1/repair`
- `POST /v1/repair-plan`
- `POST /v1/parse-lossless`
- `POST /v1/parse-check`
- `POST /v1/policy`
- `POST /v1/policy-profiles`
- `POST /v1/lsp-diagnostics`
- `POST /v1/prove`
- `POST /v1/agent-feedback`
- `GET /v1/agent-guide`
- `POST /v1/agent-guide`
- `GET /v1/diagnostic-catalog`
- `POST /v1/diagnostic-catalog`
- `GET /v1/compatibility`
- `POST /v1/compatibility`
- `POST /v1/compatibility-diff`
- `POST /v1/eval`
- `POST /v1/scorecard`
- `POST /v1/benchmark-gate`
- `POST /v1/dataset-governance`
- `POST /v1/tools/:toolName`
- `GET /v1/roadmap`
- `GET /v1/dialect-certification`

The CLI equivalent is `cypher-llm serve --host 127.0.0.1 --port 8787`.

## `createLangChainCypherAdapter(schema, options?)`

Creates a LangChain-shaped adapter without importing LangChain directly.

Methods:

- `compileQuery(query, params?)`: uses IR repair, safe execution planning, and parser-backed validation.
- `correctRawCypher(rawCypher, params?)`: supports legacy text2cypher migration with narrow raw repair plus parser-backed validation.
- `invoke(input)`: accepts `{ query, params }`, `{ rawCypher, params }`, a JSON string, or a raw Cypher string.
- `asRunnable()`: returns a Runnable-like `{ invoke }` object.
- `asTool(name?)`: returns a Tool-like object with `name`, `description`, `schema`, `invoke`, `call`, and `func`.

## Fixture Importers

The package exposes import helpers for building eval datasets from upstream sources:

- `importText2CypherCsv(csvText, options)`
- `importFunctionalCypherJson(jsonText, options)`
- `importOpenCypherTckFeature(featureText, options)`
- `inferSchemaFromCypher(cypher)`

The corresponding CLI commands write dataset, attempt, and summary JSON files:

```bash
cypher-llm import-text2cypher --csv rows.csv --dataset-out dataset.json --attempts-out attempts.json
cypher-llm import-functional-cypher --json rows.json --dataset-out dataset.json --attempts-out attempts.json
cypher-llm import-opencypher-tck --feature feature.file --dataset-out dataset.json --attempts-out attempts.json
```
