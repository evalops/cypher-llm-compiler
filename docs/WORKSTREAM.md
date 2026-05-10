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

Status: implemented through `evaluateAttempts`, `cypher-llm eval`, importer helpers, checked-in text2cypher/openCypher samples, baseline reports, CypherBench report comparison, and repair-loop feedback packets.

## 2.5 Raw-to-IR Migration

Artifacts:

- CLI command to lift common raw read queries into `CypherQuery` IR.
- Explicit raw fallback clauses and diagnostics for unsupported syntax.
- Lift-coverage eval report for imported text2cypher attempts.
- Migration docs and checked-in benchmark artifacts.

Status: initial implementation exists in `liftRawCypherToIr`, `cypher-llm lift-raw`, `cypher-llm lift-raw-eval`, `docs/RAW_LIFT.md`, and `examples/benchmarks/text2cypher-gpt4o-raw-lift.summary.json`.

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

Status: implemented for the current IR surface. Validation now covers aggregate aliasing, invalid aggregate predicates, ambiguous aggregate/scalar expressions, `CALL {}` subquery import/export scope, subquery export shadowing, procedure arguments and `YIELD` variables when `schema.procedures` metadata is present, built-in and schema-declared function arguments, property/parameter/comparison type mismatches, and dialect feature flags for Neo4j Cypher 25, openCypher 9, and GQL-oriented profiles.

## 5. Agent Integrations

Artifacts:

- OpenAI tool schema examples.
- MCP server exposing validate, repair, render, and eval tools.
- LangChain adapter that replaces regex correction.
- Migration guide for raw text2cypher chains.

Status: implemented through `src/tools.ts`, `src/mcp-server.ts`, `src/langchain.ts`, `docs/INTEGRATIONS.md`, and `examples/raw-to-ir-migration.md`. The same operation contract now reaches OpenAI function tools, MCP clients, LangChain-style chains, and direct TypeScript callers.

## Beyond: Years-Scale Program

The years-scale program is tracked publicly in issues #10-#17 and in the machine-readable roadmap under `src/years-roadmap.ts`, `schemas/years-roadmap.schema.json`, and `examples/roadmap/cypher-llm-years-roadmap.json`. Dialect certification now has its first executable lane under `src/dialect-certification.ts`, `schemas/dialect-certification.schema.json`, and `examples/certification/dialect-certification.json`. Semantic proof output has its first compact artifact under `src/proof.ts`, `schemas/cypher-proof.schema.json`, and `examples/proofs/tool-hash.proof.json`. The compiler-service workstream has its first runtime boundary under `src/http-server.ts` and `test/http-server.test.ts`.

See `docs/YEARS_ROADMAP.md` for the larger program: lossless parsing, dialect certification, public CypherBench, proof-carrying repair, compiler service APIs, cost/safety policy planning, ecosystem UX, and governance.
