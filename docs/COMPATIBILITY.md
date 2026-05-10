# Compatibility

This package treats Cypher compatibility as an explicit profile, not an implicit prompt instruction.

## Versioned Contracts

Stable public contracts:

- `cypher-llm-ir/v1`
- `cypher-llm-schema/v1`
- `cypher-llm-eval-dataset/v1`
- `cypher-llm-eval-attempts/v1`
- `cypher-llm-dialect-profile/v1`
- `cypher-llm-dialect-certification/v1`
- `cypher-llm-proof/v1`

JSON Schema artifacts live under `schemas/` and should be treated as the source of truth for model/tool input validation.

## Dialect Profiles

Checked-in profiles live under `profiles/`:

- `neo4j-cypher-25`: default stable profile.
- `opencypher-9`: preview profile for openCypher-style targets.
- `gql`: experimental forward-looking profile.

The current renderer defaults to LLM-safe Neo4j Cypher 25 behavior. Validation now enforces core feature flags such as `LET`, subqueries, write clauses, path modes, shortest path modes, and GQL range-rendering limitations. `renderQueryForDialect` applies profile rendering rules that are currently safe to express in the text renderer.

Known boundary: the GQL profile records desired relationship quantifier behavior, but the renderer still emits legacy star syntax. Validation reports `dialect-rendering-limitation` when that boundary matters.

## Certification Reports

Run:

```bash
cypher-llm certify-dialects --fail-on-fail --report-out examples/certification/dialect-certification.json
```

The report checks profile metadata, schema identifier escaping, parser acceptance for rendered reads, semantic feature gates for `LET` and path modes, and known relationship range rendering limitations. Warnings are allowed for documented experimental boundaries such as the current GQL range syntax limitation; failures indicate a profile claim is not enforced by code.

## Proof Objects

Run:

```bash
cypher-llm prove --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25 --proof-out examples/proofs/tool-hash.proof.json
```

Proofs are compact compile artifacts for agents. They include the rendered Cypher, `EXPLAIN` preflight, deterministic repair kinds, diagnostic codes, parser preflight status, and execution-policy claims. A blocked proof is not safe to execute without resolving its failed claims.

## Breaking Changes

Breaking changes require:

- A new contract version or explicit migration note.
- Updated JSON Schema.
- Updated examples.
- Changelog entry.
- Test coverage showing old/new behavior where feasible.

## Packaging

Run:

```bash
npm run verify:pack
```

The package artifact should include compiled `dist/src` output, docs, examples, profiles, schemas, `README.md`, and `CHANGELOG.md`.
