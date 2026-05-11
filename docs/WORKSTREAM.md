# Long-Horizon Workstream

The repo now has enough structure to support a multi-week implementation stream. The work should proceed in verticals that each leave behind runnable artifacts.

## 1. Contract Foundation

Artifacts:

- JSON Schema for `CypherSchemaContract`.
- JSON Schema for `CypherQuery`.
- JSON Schema for eval datasets and model attempts.
- Versioned dialect profiles and compatibility policy.
- Examples that validate against those schemas.

Status: implemented in this repo under `schemas/`, `profiles/`, `docs/COMPATIBILITY.md`, and `CHANGELOG.md`.

## 2. Offline Evals

Artifacts:

- Dataset file format for natural-language tasks, schema, params, and expected outcomes.
- Attempt file format for raw Cypher or IR outputs.
- Eval runner that reports pass rate, executable rate, repair rate, diagnostic counts, and per-task results.
- CLI command for repeatable local/CI runs.

Status: implemented through `evaluateAttempts`, `cypher-llm eval`, importer helpers, checked-in text2cypher/openCypher samples, baseline reports, CypherBench report comparison, scorecard JSON/markdown output, benchmark gate reports, retry eval reports, dataset governance reports, and repair-loop feedback packets.

## 2.5 Raw-to-IR Migration

Artifacts:

- CLI command to lift common raw read queries into `CypherQuery` IR.
- Explicit raw fallback clauses and diagnostics for unsupported syntax.
- Lift-coverage eval report for imported text2cypher attempts.
- Migration docs and checked-in benchmark artifacts.

Status: initial implementation exists in `liftRawCypherToIr`, `cypher-llm lift-raw`, `cypher-llm lift-raw-eval`, `docs/RAW_LIFT.md`, and `examples/benchmarks/text2cypher-gpt4o-raw-lift.summary.json`.

## 2.75 Lossless Parse Boundary

Artifacts:

- Exact source-fragment round trip for existing Cypher.
- Statement and clause CST nodes with comments and source spans.
- Optional parser validation against schema-aware Neo4j language support.
- Best-effort IR-preview mapping for supported single-statement read queries.

Status: initial implementation exists in `parseCypherLosslessly`, `cypher-llm parse-lossless`, `schemas/lossless-parse.schema.json`, `examples/lossless/tool-hash.lossless.json`, and `test/lossless-parser.test.ts`.

## 3. Parser and Database Verification

Artifacts:

- Parser-backed rendered-query validation.
- Neo4j `EXPLAIN` adapter.
- Runtime error mapping into the `Diagnostic` shape.
- Docker-based CI fixture.

Status: parser-backed validation is implemented through `validateRenderedQueryWithParser`, `validateCypherTextWithParser`, and `cypher-llm parse-check`. Driver-compatible database preflight is implemented through `explainWithNeo4j`, with an optional Docker-backed live Neo4j fixture and CI workflow covering real `EXPLAIN`.

## 3.5 Schema Introspection

Artifacts:

- Driver-compatible Neo4j schema introspection.
- CLI command that writes `CypherSchemaContract` JSON from a live database.
- Procedure yield metadata import for semantic validation.
- Redaction and sampling guidance.

Status: initial implementation exists in `introspectNeo4jSchema`, `cypher-llm introspect-neo4j`, and `docs/NEO4J_INTROSPECTION.md`.

## 4. Semantic Analyzer Expansion

Artifacts:

- Aggregation and grouping diagnostics.
- Subquery import/export scope tracking.
- Procedure yield validation.
- Dialect-specific rendering and validation.
- Property and parameter type checks.

Status: implemented for the current IR surface. Validation now covers aggregate aliasing, invalid aggregate predicates, ambiguous aggregate/scalar expressions, `CALL {}` subquery import/export scope, subquery export shadowing, procedure arguments and `YIELD` variables when `schema.procedures` metadata is present, built-in and schema-declared function arguments, property/parameter/comparison type mismatches, and dialect feature flags for Neo4j Cypher 25, openCypher 9, and GQL-oriented profiles. Repair planning now separates deterministic compiler patches from model-required and unsafe fixes, and repair steps carry source anchors when their IR paths can be mapped to lossless clause spans.

## 5. Agent Integrations

Artifacts:

- OpenAI tool schema examples.
- MCP server exposing validate, repair, render, and eval tools.
- LangChain adapter that replaces regex correction.
- Migration guide for raw text2cypher chains.
- Machine-readable agent guide for workflow and diagnostic playbooks.
- Machine-readable diagnostic catalog for stable finding-code metadata and model actions.

Status: implemented through `src/tools.ts`, `src/mcp-server.ts`, `src/langchain.ts`, `src/agent-guide.ts`, `src/diagnostic-catalog.ts`, `docs/INTEGRATIONS.md`, and `examples/raw-to-ir-migration.md`. The same operation contract now reaches OpenAI function tools, MCP clients, HTTP clients, LangChain-style chains, direct TypeScript callers, and LLM-facing guide and diagnostic-catalog consumers.

## Beyond: Years-Scale Program

The years-scale program is tracked publicly in issues #10-#17 and in the machine-readable roadmap under `src/years-roadmap.ts`, `schemas/years-roadmap.schema.json`, and `examples/roadmap/cypher-llm-years-roadmap.json`. Lossless parsing now has byte-preserving report and conformance lanes under `src/lossless-parser.ts`, `src/lossless-conformance.ts`, `schemas/lossless-parse.schema.json`, `schemas/lossless-conformance.schema.json`, `examples/lossless/tool-hash.lossless.json`, and `examples/lossless/conformance.json`. CypherBench now has its first public scorecard, gate, and retry-eval lanes under `src/scorecard.ts`, `src/benchmark-gate.ts`, `src/retry-eval.ts`, `schemas/cypherbench-scorecard.schema.json`, `schemas/benchmark-gate.schema.json`, `schemas/retry-eval.schema.json`, `examples/benchmarks/tool-hash.scorecard.json`, `examples/benchmarks/tool-hash.benchmark-gate.json`, and `examples/benchmarks/tool-hash.retry-eval.json`, plus dataset governance under `src/dataset-governance.ts`, `schemas/dataset-governance.schema.json`, and `examples/benchmarks/tool-hash.dataset-governance.json`. Dialect certification now has separated profile, renderer, parser, semantic, and live-database lanes plus CI-backed live evidence under `src/dialect-certification.ts`, `schemas/dialect-certification.schema.json`, `schemas/dialect-live-evidence.schema.json`, `examples/certification/dialect-certification.json`, and `examples/certification/live-database-evidence.json`. Semantic proof and repair planning now have compact artifacts under `src/proof.ts`, `src/repair-plan.ts`, `schemas/cypher-proof.schema.json`, `schemas/repair-plan.schema.json`, `examples/proofs/tool-hash.proof.json`, and `examples/proofs/tool-hash.repair-plan.json`. Cost and safety policy has report, eval, planner-estimate, schema-statistics, policy-rule, and named-profile lanes under `src/policy.ts`, `src/policy-eval.ts`, `src/planner-estimate.ts`, `src/schema-statistics.ts`, `src/policy-rules.ts`, `src/policy-profile.ts`, `schemas/policy-report.schema.json`, `schemas/policy-eval.schema.json`, `schemas/planner-estimate.schema.json`, `schemas/schema-statistics.schema.json`, `schemas/policy-rules.schema.json`, `schemas/policy-profile.schema.json`, `examples/policy/tool-hash.policy.json`, `examples/policy/tool-hash.policy-eval.json`, `examples/policy/tool-hash.planner-estimate.json`, `examples/policy/tool-hash.schema-statistics.json`, `examples/policy/tool-hash.policy-rules.json`, and `examples/policy/policy-profiles.json`. Ecosystem UX has its first editor/agent diagnostics lane under `src/lsp.ts`, `schemas/lsp-diagnostics.schema.json`, and `examples/lsp/tool-hash.lsp.json`, plus the first machine-readable diagnostic-code catalog under `src/diagnostic-catalog.ts`, `schemas/diagnostic-catalog.schema.json`, and `examples/diagnostics/diagnostic-catalog.json`. The compiler-service workstream now has a runtime boundary plus versioned manifest, metrics, OpenAPI contract, and operational controls under `src/http-server.ts`, `src/service-manifest.ts`, `src/service-metrics.ts`, `src/service-openapi.ts`, `schemas/service-manifest.schema.json`, `schemas/service-metrics.schema.json`, `schemas/service-openapi.schema.json`, `examples/service/service-manifest.json`, `examples/service/service-metrics.json`, `examples/service/service-openapi.json`, and `test/http-server.test.ts`. Governance now has compatibility catalog, diff-gate, and contract-conformance artifacts under `src/compatibility.ts`, `src/compatibility-diff.ts`, `src/contract-conformance.ts`, `schemas/compatibility-catalog.schema.json`, `schemas/compatibility-diff.schema.json`, `schemas/contract-conformance.schema.json`, `examples/governance/compatibility-catalog.json`, `examples/governance/compatibility-diff.json`, and `examples/governance/contract-conformance.json`.

See `docs/YEARS_ROADMAP.md` for the larger program: lossless parsing, dialect certification, public CypherBench, proof-carrying repair, compiler service APIs, cost/safety policy planning, ecosystem UX, and governance.
