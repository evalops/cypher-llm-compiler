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

## Repository Layout

- `src/ir.ts`: Public IR and schema types.
- `src/schema.ts`: Schema normalization, alias lookup, identifier metadata.
- `src/render.ts`: Deterministic Cypher renderer.
- `src/validate.ts`: Semantic diagnostics and LLM-safe profile checks.
- `src/repair.ts`: Structured repair actions over IR and limited raw-Cypher bootstrap repair.
- `src/normalize.ts`: Stable query normalization and equivalence helpers.
- `src/safety.ts`: Safe execution planning.
- `src/failure-corpus.ts`: Runnable corpus of LLM failure cases.
- `docs/`: Design notes and LLM integration guidance.
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
