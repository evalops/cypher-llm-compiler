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

This package implements eight concrete improvements:

1. **Official JSON IR**: Agents can emit a small, typed Cypher AST instead of brittle text.
2. **LLM-safe profile**: The renderer emits conservative Cypher with escaped schema identifiers, explicit projections, bounded path recommendations, and deterministic formatting.
3. **Typed schema contract**: Labels, relationship types, properties, parameters, aliases, and path templates are machine-readable.
4. **Diagnostics as repair API**: Validation returns stable codes, structured paths, severity, and repair hints.
5. **AST repair**: Common LLM mistakes are corrected at the IR level before rendering.
6. **Equivalence normalizer**: Queries render into stable canonical text for evals and regression tests.
7. **Safe execution modes**: Query planning separates render/validate/repair from `EXPLAIN`, read-only, and approval-required execution choices.
8. **Failure corpus**: Known LLM failure cases live as runnable fixtures, not anecdotes.

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
cypher-llm corpus
cypher-llm eval --dataset examples/eval-dataset.json --attempts examples/eval-attempts.json --default-limit 25
cypher-llm compare-evals --baseline baseline.report.json --candidate candidate.report.json
cypher-llm repair-loop --dataset examples/eval-dataset.json --attempts examples/eval-attempts.json --default-limit 25
cypher-llm parse-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --default-limit 25
cypher-llm introspect-neo4j --uri bolt://localhost:7687 --user neo4j --password "$NEO4J_PASSWORD" --schema-out schema.json
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

`compare-evals` compares two reports and marks directional metric deltas as improvements or regressions.

`repair-loop` emits model-targeted repair packets from eval diagnostics and failed expectations.

`parse-check` validates rendered IR or raw Cypher against Neo4j's language-support parser and maps parser diagnostics back into this package's `Diagnostic` shape.

`introspect-neo4j` connects to Neo4j and writes a `CypherSchemaContract` from labels, relationship types, properties, observed endpoints, and procedure yields.

`mcp` starts a stdio MCP server exposing the same render, validate, repair, parse-check, and eval operations to agent clients.

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
- `unbounded-variable-length-path`
- `raw-cypher-escape-hatch`
- `raw-expression-escape-hatch`
- `write-requires-approval`
- `execution-approval-required`
- `missing-required-parameter`
- `no-cypher-output`
- `sqlism-between`
- `raw-identifier-quoted`

## Compatibility Strategy

The renderer emits ordinary Cypher. The structured layer exists before the text boundary and can be discarded after rendering. That means existing database drivers, Neo4j deployments, LangChain-style chains, and text2cypher eval harnesses can adopt this incrementally:

- Raw chains can start with `repairRawCypher` and diagnostics.
- New chains should emit `CypherQuery` IR directly.
- Evals can compare `normalizeQuery` output instead of brittle free-form strings.
- Operators can gate writes through `createSafeExecutionPlan`.

## What This Does Not Do Yet

- It does not embed a full Cypher parser.
- It does not execute against a database.
- It does not claim semantic equivalence beyond canonical rendering of this IR.
- It does not make regex raw-query repair broad on purpose.

Those are deliberate boundaries. The repo is the missing LLM compiler surface, not a database driver or a complete reimplementation of Neo4j.

## Repository Layout

- `src/ir.ts`: Public IR and schema types.
- `src/schema.ts`: Schema normalization, alias lookup, identifier metadata.
- `src/neo4j-introspect.ts`: Driver-compatible Neo4j schema introspection.
- `src/render.ts`: Deterministic Cypher renderer.
- `src/validate.ts`: Semantic diagnostics and LLM-safe profile checks.
- `src/repair.ts`: Structured repair actions over IR and limited raw-Cypher bootstrap repair.
- `src/normalize.ts`: Stable query normalization and equivalence helpers.
- `src/safety.ts`: Safe execution planning.
- `src/failure-corpus.ts`: Runnable corpus of LLM failure cases.
- `src/eval-compare.ts`: CypherBench report comparison and regression detection.
- `src/repair-loop.ts`: Eval-driven repair feedback packets for model retry loops.
- `src/fixture-importers.ts`: Importers for text2cypher CSV/JSON and openCypher TCK fixtures.
- `src/parser-validation.ts`: Parser-backed validation through Neo4j language support.
- `src/neo4j-explain.ts`: Driver-compatible Neo4j `EXPLAIN` preflight adapter.
- `src/tools.ts`: OpenAI/MCP-compatible tool schemas and shared tool dispatcher.
- `src/mcp-server.ts`: Stdio MCP server for agent clients.
- `src/langchain.ts`: LangChain-shaped adapter for structured IR repair plus parser validation.
- `src/cli.ts`: JSON-in/JSON-out CLI for agents and eval harnesses.
- `docs/`: Design notes and LLM integration guidance.
- `docker-compose.neo4j.yml`: Optional local Neo4j fixture for live `EXPLAIN` tests.
- `examples/`: Small schema/query fixtures for CLI smoke tests and agent onboarding.
- `examples/benchmarks/`: CypherBench raw-vs-IR reports, comparisons, and repair-loop artifacts.
- `examples/imported/`: Imported text2cypher/openCypher fixture samples and baseline reports.
- `profiles/`: Versioned dialect profiles for Neo4j Cypher 25, openCypher 9, and GQL-oriented output.
- `schemas/`: JSON Schema contracts for IR, graph schema, eval datasets, and eval attempts.
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
