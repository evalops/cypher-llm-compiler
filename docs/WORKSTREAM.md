# Long-Horizon Workstream

The repo now has enough structure to support a multi-week implementation stream. The work should proceed in verticals that each leave behind runnable artifacts.

## 1. Contract Foundation

Artifacts:

- JSON Schema for `CypherSchemaContract`.
- JSON Schema for `CypherQuery`.
- JSON Schema for eval datasets and model attempts.
- Examples that validate against those schemas.

Status: started in this repo under `schemas/`.

## 2. Offline Evals

Artifacts:

- Dataset file format for natural-language tasks, schema, params, and expected outcomes.
- Attempt file format for raw Cypher or IR outputs.
- Eval runner that reports pass rate, executable rate, repair rate, diagnostic counts, and per-task results.
- CLI command for repeatable local/CI runs.

Status: started through `evaluateAttempts` and `cypher-llm eval`.

## 3. Parser and Database Verification

Artifacts:

- Parser-backed rendered-query validation.
- Neo4j `EXPLAIN` adapter.
- Runtime error mapping into the `Diagnostic` shape.
- Docker-based CI fixture.

Status: parser-backed validation has started through `validateRenderedQueryWithParser`, `validateCypherTextWithParser`, and `cypher-llm parse-check`. Driver-compatible database preflight has started through `explainWithNeo4j`; a Docker-backed live Neo4j CI fixture remains the next vertical.

## 4. Semantic Analyzer Expansion

Artifacts:

- Aggregation and grouping diagnostics.
- Subquery import/export scope tracking.
- Procedure yield validation.
- Dialect-specific rendering and validation.
- Property and parameter type checks.

Status: started with aggregation diagnostics for `MATCH WHERE` aggregate placement and ambiguous aggregate/scalar projection expressions. This is where LLM failures become precise repair instructions instead of broad invalid-query reports.

## 5. Agent Integrations

Artifacts:

- OpenAI tool schema examples.
- MCP server exposing validate, repair, render, and eval tools.
- LangChain adapter that replaces regex correction.
- Migration guide for raw text2cypher chains.

This is how the compiler becomes easy to adopt.
