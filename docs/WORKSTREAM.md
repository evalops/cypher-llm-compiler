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

Status: implemented through `evaluateAttempts`, `cypher-llm eval`, importer helpers, checked-in text2cypher/openCypher samples, and baseline reports.

## 3. Parser and Database Verification

Artifacts:

- Parser-backed rendered-query validation.
- Neo4j `EXPLAIN` adapter.
- Runtime error mapping into the `Diagnostic` shape.
- Docker-based CI fixture.

Status: parser-backed validation is implemented through `validateRenderedQueryWithParser`, `validateCypherTextWithParser`, and `cypher-llm parse-check`. Driver-compatible database preflight is implemented through `explainWithNeo4j`, with an optional Docker-backed live Neo4j fixture and CI workflow covering real `EXPLAIN`.

## 4. Semantic Analyzer Expansion

Artifacts:

- Aggregation and grouping diagnostics.
- Subquery import/export scope tracking.
- Procedure yield validation.
- Dialect-specific rendering and validation.
- Property and parameter type checks.

Status: implemented for the current IR surface. Validation now covers aggregate aliasing, invalid aggregate predicates, ambiguous aggregate/scalar expressions, `CALL {}` subquery import/export scope, subquery export shadowing, and procedure `YIELD` variables when `schema.procedures` metadata is present.

## 5. Agent Integrations

Artifacts:

- OpenAI tool schema examples.
- MCP server exposing validate, repair, render, and eval tools.
- LangChain adapter that replaces regex correction.
- Migration guide for raw text2cypher chains.

Status: implemented through `src/tools.ts`, `src/mcp-server.ts`, `src/langchain.ts`, `docs/INTEGRATIONS.md`, and `examples/raw-to-ir-migration.md`. The same operation contract now reaches OpenAI function tools, MCP clients, LangChain-style chains, and direct TypeScript callers.
