# Cypher LLM Compiler

Cypher is expressive enough for humans, but the surfaces most LLMs touch today are mostly plain strings plus prose schema dumps. That makes models fail in predictable ways: relationship types with spaces are not escaped, directionality is guessed, variables drift out of scope, aggregate expressions are placed in invalid clauses, and query-correction layers patch text with regexes after the model already produced an invalid program.

This repository is a bit-for-bit-compatible Cypher authoring layer designed for LLMs. It does not try to replace Cypher. It gives agents a structured intermediate representation, a typed schema contract, deterministic rendering, compiler-grade diagnostics, safe execution planning, and a failure corpus that can be reused in evals.

## Why This Exists

The research pass looked at the current Cypher ecosystem with `gh`:

- `opencypher/openCypher` already has a formal grammar, TCK, and a rich semantic error vocabulary.
- `neo4j/docs-cypher` shows modern Cypher/GQL features such as `LET`, `FILTER`, path modes, and the Cypher 25/GQL conformance boundary.
- `neo4j/cypher-language-support` has parser, formatter, autocomplete, symbol table, and semantic-analysis pieces that are useful but exposed for editor workflows rather than LLM repair loops.
- `neo4j/cypher-dsl` gives type-safe Java construction, but its own package docs note that the AST is not type-validated and can still render runtime-invalid Cypher.
- `langchain-ai/langchain-neo4j` demonstrates the common production pattern: prompt the model for raw Cypher, extract a fenced block, and then run regex-based relationship-direction correction.
- `neo4j-labs/text2cypher` has thousands of generated attempts with observed syntax errors, timeouts, empty/no-Cypher outputs, and result/no-result labels.

The gap is not "LLMs need a better prompt." The gap is a missing compiler boundary that agents can use directly.

## What This Implements

This package implements twenty-two concrete improvements:

1. **Official JSON IR**: Agents can emit a small, typed Cypher AST instead of brittle text.
2. **LLM-safe profile**: The renderer emits conservative Cypher with escaped schema identifiers, explicit projections, bounded path recommendations, and deterministic formatting.
3. **Typed schema contract**: Labels, relationship types, properties, parameters, aliases, and path templates are machine-readable.
4. **Diagnostics as repair API**: Validation returns stable codes, structured paths, severity, and repair hints.
5. **AST repair**: Common LLM mistakes are corrected at the IR level before rendering.
6. **Equivalence normalizer**: Queries render into stable canonical text for evals and regression tests.
7. **Safe execution modes**: Query planning separates render/validate/repair from `EXPLAIN`, read-only, and approval-required execution choices.
8. **Failure corpus**: Known LLM failure cases live as runnable fixtures, not anecdotes.
9. **Roadmap governance**: Multi-year compiler ambitions are tracked as public issues plus a machine-readable capability ledger.
10. **Dialect certification**: Neo4j Cypher, openCypher, and GQL profile claims produce CI-checkable certification reports.
11. **Proof-carrying compile output**: Agents can ask why a query is accepted, repaired, blocked, or approval-gated.
12. **Cost and safety policy reports**: Broad scans, risky traversals, high limits, cartesian patterns, and writes are surfaced before execution.
13. **Named policy profiles**: Agents can select audited built-in or custom cost/safety profiles instead of hand-assembling loose booleans.
14. **Planner estimate policy gates**: `EXPLAIN`-style cardinality, db-hit, and operator evidence can feed policy findings before execution.
15. **Schema statistics policy gates**: Cardinality, index, and relationship-fanout metadata can flag expensive graph access before planning.
16. **LSP-style diagnostics**: Editor and agent UIs can consume compiler diagnostics and code actions in a familiar shape.
17. **Lossless parse reports**: Existing Cypher can be preserved byte-for-byte while agents inspect statements, clauses, comments, source spans, parser output, and IR-preview coverage.
18. **CypherBench scorecards**: Eval reports can be published as ranked JSON and markdown scorecards across raw, IR-first, repaired, parser-validated, and mixed lanes.
19. **Dataset governance reports**: Benchmark datasets can be audited for provenance, split assignment, redaction findings, duplicate ids, and public-release diagnostics.
20. **Ranked repair plans**: Agents can receive deterministic patches, model-required fixes, and unsafe blockers as separate ranked plan steps.
21. **Service manifest and controls**: Agent runtimes can discover HTTP routes, auth posture, request limits, audit redaction, and data-boundary guarantees.
22. **Benchmark gates**: CI can publish pass/fail CypherBench gates over metric regressions, pass-rate floors, executable-rate floors, and optional diagnostic regressions.

## Quick Start

Install dependencies and run the suite:

```bash
npm install
npm test
```

Use the CLI against JSON schema/query files:

```bash
npm run build
npx cypher-llm render \
  --schema examples/tool-hash.schema.json \
  --query examples/tool-hash.query.json \
  --params examples/tool-hash.params.json \
  --default-limit 25 \
  --default-max-hops 5
```

Or use the library directly:

```ts
import {
  normalizeSchema,
  renderQuery,
  repairQuery,
  validateQuery
} from "@evalops/cypher-llm-compiler";

const schema = normalizeSchema({
  version: "cypher-llm-schema/v1",
  dialect: "neo4j-cypher-25",
  nodes: [
    { name: "Tool", properties: { name: { type: "STRING" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [
    { type: "has MD5 hash", from: "Tool", to: "Hash" }
  ],
  parameters: {
    toolName: "STRING"
  }
});

const query = {
  version: "cypher-llm-ir/v1",
  profile: "llm-safe-readonly",
  clauses: [
    {
      kind: "match",
      patterns: [
        {
          segments: [
            { variable: "tool", labels: ["Tool"], properties: { name: { kind: "param", name: "toolName" } } },
            { rel: { types: ["has MD5 hash"], direction: "out" }, node: { variable: "hash", labels: ["Hash"] } }
          ]
        }
      ]
    },
    {
      kind: "return",
      items: [
        { expression: { kind: "prop", object: { kind: "var", name: "hash" }, key: "value" }, alias: "md5" }
      ]
    }
  ]
} as const;

const repaired = repairQuery(query, schema, { defaultLimit: 25 });
const diagnostics = validateQuery(repaired.query, schema);
const cypher = renderQuery(repaired.query);

console.log(diagnostics);
console.log(cypher);
```

Rendered Cypher:

```cypher
MATCH (tool:`Tool` {`name`: $toolName})-[:`has MD5 hash`]->(hash:`Hash`)
RETURN hash.`value` AS md5
LIMIT 25
```

## CLI

The CLI is intentionally boring JSON in, JSON out so it can be called by agents, eval harnesses, CI, and editor integrations.

```bash
cypher-llm render --schema schema.json --query query.json --params params.json --default-limit 25
cypher-llm validate --schema schema.json --query query.json
cypher-llm repair-raw --schema schema.json --cypher "MATCH (t:Tool)-[:has MD5 hash]->(h:Hash) RETURN h"
cypher-llm repair-plan --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25
cypher-llm lift-raw --schema schema.json --cypher "MATCH (t:Tool)-[:has MD5 hash]->(h:Hash) RETURN h"
cypher-llm parse-lossless --schema examples/tool-hash.schema.json --cypher "MATCH (t:Tool) RETURN t"
cypher-llm corpus
cypher-llm eval --dataset examples/eval-dataset.json --attempts examples/eval-attempts.json --default-limit 25
cypher-llm compare-evals --baseline baseline.report.json --candidate candidate.report.json
cypher-llm scorecard --reports baseline.report.json,candidate.report.json --markdown-out scorecard.md
cypher-llm benchmark-gate --baseline baseline.report.json --candidate candidate.report.json --min-pass-rate 0.95 --fail-on-fail
cypher-llm dataset-governance --dataset examples/eval-dataset.json --report-out governance.json
cypher-llm repair-loop --dataset examples/eval-dataset.json --attempts examples/eval-attempts.json --default-limit 25
cypher-llm lift-raw-eval --dataset examples/imported/text2cypher-gpt4o-sample.dataset.json --attempts examples/imported/text2cypher-gpt4o-sample.attempts.json
cypher-llm parse-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --default-limit 25
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --planner-estimate examples/policy/tool-hash.planner-estimate.json --schema-statistics examples/policy/tool-hash.schema-statistics.json --report-out policy.json
cypher-llm policy-profiles --profiles-out policy-profiles.json
cypher-llm lsp-diagnostics --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --report-out lsp.json
cypher-llm prove --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25
cypher-llm introspect-neo4j --uri bolt://localhost:7687 --user neo4j --password "$NEO4J_PASSWORD" --schema-out schema.json
cypher-llm roadmap --integrity
cypher-llm certify-dialects --fail-on-fail
cypher-llm service-manifest --manifest-out service-manifest.json
cypher-llm serve --host 127.0.0.1 --port 8787
cypher-llm serve --host 127.0.0.1 --port 8787 --require-auth --auth-token "$CYPHER_LLM_HTTP_TOKEN" --audit-log audit.jsonl
cypher-llm import-text2cypher --csv rows.csv --dataset-out dataset.json --attempts-out attempts.json
cypher-llm mcp
npm run test:live:neo4j
```

`render` returns a `SafeExecutionPlan`:

- `cypher`: canonical Cypher text.
- `preflightCypher`: the same query prefixed with `EXPLAIN`.
- `diagnostics`: stable diagnostic objects.
- `repairs`: deterministic repairs applied before rendering.
- `requiresApproval`: true for graph mutations without explicit approval.
- `canExecute`: false if errors remain or approval is required.

`eval` returns a `cypher-llm-eval-report/v1` report with pass rate, executable rate, repair rate, diagnostic counts, and per-task outcomes.

`repair-plan` emits a `cypher-llm-repair-plan/v1` object that separates deterministic JSON-patch-like repairs, model-required diagnostics, and unsafe or approval-gated blockers.

`compare-evals` compares two reports and marks directional metric deltas as improvements or regressions.

`scorecard` emits a `cypher-llm-cypherbench-scorecard/v1` JSON report or markdown table from one or more eval reports.

`benchmark-gate` emits a `cypher-llm-benchmark-gate/v1` pass/fail report for CI regression gates over eval comparisons and configured metric floors.

`dataset-governance` emits a `cypher-llm-dataset-governance/v1` report covering provenance, split assignment, redaction findings, duplicate ids, and stable diagnostics.

`repair-loop` emits model-targeted repair packets from eval diagnostics and failed expectations.

`lift-raw` converts common read-query Cypher strings into structured `CypherQuery` IR, preserving unsupported syntax as explicit raw clauses.

`lift-raw-eval` measures raw-to-IR lift coverage across an eval attempt file.

`parse-lossless` emits a `cypher-llm-lossless-parse/v1` report that preserves exact source fragments, comments, statements, clauses, source spans, optional parser diagnostics, and a best-effort IR preview.

`parse-check` validates rendered IR or raw Cypher against Neo4j's language-support parser and maps parser diagnostics back into this package's `Diagnostic` shape.

`policy-check` emits a `cypher-llm-policy-report/v1` report for static cost, cardinality, schema-statistics, planner-estimate, and safety risks before execution.

`policy-profiles` emits a `cypher-llm-policy-profile-catalog/v1` catalog of named safety policies for autonomous agents and governed write paths. `policy-check` accepts `--policy-profile-id` or `--policy-profile` and records the selected profile in the report.

`lsp-diagnostics` emits a `cypher-llm-lsp-diagnostics/v1` report with LSP-shaped diagnostics and code actions.

`prove` emits a `cypher-llm-proof/v1` proof object with rendered Cypher, preflight Cypher, repair kinds, diagnostic codes, parser preflight, and execution-policy claims.

`introspect-neo4j` connects to Neo4j and writes a `CypherSchemaContract` from labels, relationship types, properties, observed endpoints, and procedure yields.

`roadmap` emits the years-scale public workstream and capability ledger as JSON or markdown.

`certify-dialects` emits a `cypher-llm-dialect-certification/v1` report that checks profile metadata, renderer behavior, parser acceptance, semantic feature gates, and known rendering limitations.

`service-manifest` emits a `cypher-llm-service-manifest/v1` report covering HTTP routes, auth requirements, body limits, audit redaction, and data-boundary guarantees.

`mcp` starts a stdio MCP server exposing the same compiler operation set as the OpenAI tool definitions and HTTP dispatcher.

`serve` starts a local JSON HTTP service exposing `/healthz`, `/v1/service-manifest`, `/v1/tools`, `/v1/render`, `/v1/validate`, `/v1/repair`, `/v1/repair-plan`, `/v1/parse-lossless`, `/v1/parse-check`, `/v1/policy`, `/v1/policy-profiles`, `/v1/lsp-diagnostics`, `/v1/prove`, `/v1/eval`, `/v1/scorecard`, `/v1/benchmark-gate`, `/v1/dataset-governance`, `/v1/roadmap`, and `/v1/dialect-certification`. Set `--require-auth` with `--auth-token` or `CYPHER_LLM_HTTP_TOKEN` to require bearer auth for runtime routes; `--audit-log` writes JSONL audit events without request or response payloads.

`test:live:neo4j` runs the optional Docker-backed Neo4j `EXPLAIN` fixture when `CYPHER_LLM_NEO4J_URI` and `CYPHER_LLM_NEO4J_PASSWORD` are set.

## Agent Integrations

The package exports OpenAI tool definitions, an MCP server, and a LangChain-shaped adapter:

```ts
import {
  createLangChainCypherAdapter,
  executeCypherCompilerTool,
  getOpenAiResponsesTools
} from "@evalops/cypher-llm-compiler";

const openAiTools = getOpenAiResponsesTools();
const toolOutput = await executeCypherCompilerTool("cypher_render", {
  schema,
  query,
  defaultLimit: 25,
  defaultMaxHops: 5
});

const adapter = createLangChainCypherAdapter(schema, {
  defaultLimit: 25,
  defaultMaxHops: 5,
  parserMode: "lint"
});
const compiled = await adapter.compileQuery(query);
```

See `docs/INTEGRATIONS.md` and `examples/raw-to-ir-migration.md` for the full adoption path from raw text2cypher to structured IR.

## LLM Integration Contract

The recommended agent loop is:

1. Fetch or build a `CypherSchemaContract`.
2. Ask the LLM for `CypherQuery` JSON, not Cypher text.
3. Run `repairQuery` with conservative defaults such as `defaultLimit` and `defaultMaxHops`.
4. Run `validateQuery`.
5. If diagnostics include errors, send only stable diagnostic codes, paths, messages, and suggestions back to the LLM.
6. Render with `renderQuery` only after the structured query is acceptable.
7. Execute `preflightCypher` first when using a real database adapter.

This keeps the model inside a compiler loop instead of a string-generation loop.

## Diagnostic Shape

Diagnostics are stable API objects:

```ts
{
  code: "undefined-variable",
  severity: "error",
  path: "/clauses/2/items/0/expression",
  message: "Variable 'tool' is not in scope.",
  suggestion: "Introduce the variable in MATCH/UNWIND/LET/WITH or project it through WITH.",
  repair: {
    kind: "restore-scope",
    description: "Project the variable through the preceding WITH clause or rename this reference."
  }
}
```

Current diagnostic codes include:

- `unknown-label`
- `unknown-relationship-type`
- `unknown-property`
- `unknown-parameter`
- `undefined-variable`
- `missing-limit`
- `missing-return`
- `relationship-direction-mismatch`
- `aggregate-in-match-where`
- `aggregate-alias-required`
- `invalid-aggregation`
- `ambiguous-aggregation-expression`
- `subquery-import-undefined`
- `subquery-missing-return`
- `subquery-variable-shadowing`
- `missing-procedure`
- `unknown-procedure`
- `unknown-procedure-yield`
- `property-type-mismatch`
- `parameter-type-mismatch`
- `comparison-type-mismatch`
- `function-argument-mismatch`
- `procedure-argument-mismatch`
- `dialect-unsupported-feature`
- `dialect-rendering-limitation`
- `unbounded-variable-length-path`
- `raw-cypher-escape-hatch`
- `raw-expression-escape-hatch`
- `write-requires-approval`
- `execution-approval-required`
- `missing-required-parameter`
- `no-cypher-output`
- `sqlism-between`
- `raw-identifier-quoted`
- `raw-lift-unsupported-clause`
- `raw-lift-parser-diagnostic`

## Compatibility Strategy

The renderer emits ordinary Cypher. The structured layer exists before the text boundary and can be discarded after rendering. That means existing database drivers, Neo4j deployments, LangChain-style chains, and text2cypher eval harnesses can adopt this incrementally:

- Raw chains can start with `repairRawCypher` and diagnostics.
- Migration chains can use `liftRawCypherToIr` to turn common raw reads into IR.
- New chains should emit `CypherQuery` IR directly.
- Evals can compare `normalizeQuery` output instead of brittle free-form strings.
- Operators can gate writes through `createSafeExecutionPlan`.

## What This Does Not Do Yet

- It does not embed a full grammar-complete Cypher parser; the lossless parser preserves source structure while raw lifting still covers common read-query migration shapes only.
- It does not execute against a database.
- It does not claim semantic equivalence beyond canonical rendering of this IR.
- It does not make regex raw-query repair broad on purpose.

Those are deliberate boundaries. The repo is the missing LLM compiler surface, not a database driver or a complete reimplementation of Neo4j.

## Repository Layout

- `src/ir.ts`: Public IR and schema types.
- `src/schema.ts`: Schema normalization, alias lookup, identifier metadata.
- `src/neo4j-introspect.ts`: Driver-compatible Neo4j schema introspection.
- `src/render.ts`: Deterministic Cypher renderer and dialect render entrypoint.
- `src/validate.ts`: Semantic type, dialect, and LLM-safe profile diagnostics.
- `src/repair.ts`: Structured repair actions over IR and limited raw-Cypher bootstrap repair.
- `src/repair-plan.ts`: Ranked deterministic, model-required, and unsafe repair plans.
- `src/raw-lift.ts`: Raw Cypher to IR migration bridge and lift-coverage evals.
- `src/lossless-parser.ts`: Lossless source preservation, comment/span extraction, clause CST, and IR-preview mapping.
- `src/normalize.ts`: Stable query normalization and equivalence helpers.
- `src/safety.ts`: Safe execution planning.
- `src/failure-corpus.ts`: Runnable corpus of LLM failure cases.
- `src/eval-compare.ts`: CypherBench report comparison and regression detection.
- `src/scorecard.ts`: CypherBench JSON and markdown scorecard generation.
- `src/benchmark-gate.ts`: CI-friendly benchmark gate reports over comparisons and metric floors.
- `src/repair-loop.ts`: Eval-driven repair feedback packets for model retry loops.
- `src/dialect-certification.ts`: Executable dialect certification checks for profile claims.
- `src/proof.ts`: Proof-carrying compile output for agent feedback loops.
- `src/years-roadmap.ts`: Public years-scale workstream and capability ledger.
- `src/fixture-importers.ts`: Importers for text2cypher CSV/JSON and openCypher TCK fixtures.
- `src/dataset-governance.ts`: Dataset provenance, split, and redaction governance reports.
- `src/parser-validation.ts`: Parser-backed validation through Neo4j language support.
- `src/planner-estimate.ts`: Neo4j-like planner summary extraction and planner-estimate helpers.
- `src/policy.ts`: Static cost, cardinality, and safety policy checks.
- `src/policy-profile.ts`: Named policy profile catalog and policy-option helpers.
- `src/schema-statistics.ts`: Schema cardinality, index, and fanout statistics helpers.
- `src/neo4j-explain.ts`: Driver-compatible Neo4j `EXPLAIN` preflight adapter.
- `src/tools.ts`: OpenAI/MCP-compatible tool schemas and shared tool dispatcher.
- `src/mcp-server.ts`: Stdio MCP server for agent clients.
- `src/http-server.ts`: JSON HTTP compiler service for agent runtimes.
- `src/service-manifest.ts`: Versioned HTTP service manifest, route list, auth/audit contract, and body-limit defaults.
- `src/lsp.ts`: LSP-style diagnostics and code actions for editor and agent UIs.
- `src/langchain.ts`: LangChain-shaped adapter for structured IR repair plus parser validation.
- `src/cli.ts`: JSON-in/JSON-out CLI for agents and eval harnesses.
- `docs/`: Design notes and LLM integration guidance, including `docs/LOSSLESS_PARSE.md`, `docs/RAW_LIFT.md`, and `docs/YEARS_ROADMAP.md`.
- `docker-compose.neo4j.yml`: Optional local Neo4j fixture for live `EXPLAIN` tests.
- `examples/`: Small schema/query fixtures for CLI smoke tests and agent onboarding.
- `examples/benchmarks/`: CypherBench raw-vs-IR reports, comparisons, scorecards, gates, and repair-loop artifacts.
- `examples/certification/`: Checked-in dialect certification report.
- `examples/imported/`: Imported text2cypher/openCypher fixture samples and baseline reports.
- `examples/lossless/`: Checked-in lossless parse report.
- `examples/lsp/`: Checked-in LSP diagnostics report.
- `examples/policy/`: Checked-in cost and safety policy report, planner estimate fixture, schema statistics fixture, and policy profile catalog.
- `examples/proofs/`: Checked-in proof-carrying compile output.
- `examples/roadmap/`: Machine-readable years-scale roadmap snapshot.
- `examples/service/`: Checked-in compiler service manifest.
- `profiles/`: Versioned dialect profiles for Neo4j Cypher 25, openCypher 9, and GQL-oriented output.
- `schemas/`: JSON Schema contracts for IR, graph schema, planner estimates, schema statistics, policy reports/profiles, repair plans, service manifests, benchmark gates, lossless parse reports, dataset governance, eval datasets, and eval attempts.
- `test/`: Node test-runner coverage for renderer, schema, validation, repair, safety, and corpus behavior.

## Design Rules

- Preserve Cypher as the execution language.
- Prefer typed objects over prompt prose.
- Escape schema identifiers deterministically.
- Treat diagnostics as API, not human-only strings.
- Keep raw text repair narrow and explicit.
- Make unsafe or ambiguous behavior visible before a database sees the query.
- Keep eval fixtures in the repo so improvements are measurable.

## Status

This is an implementation prototype intended to become the LLM-facing compiler layer that Cypher currently lacks. It is deliberately small enough to review, but complete enough to validate the main product claim: LLMs should write structured Cypher programs, receive compiler diagnostics, repair structured programs, and render canonical Cypher only at the boundary.

## Next Hardening Pass

The highest-value next pass is to grow type and dialect coverage:

- Add richer property and parameter type checks.
- Keep importing larger text2cypher/openCypher slices as regression fixtures.
- Harden dialect-specific render modes for openCypher 9, Cypher 25, and emerging GQL syntax.
