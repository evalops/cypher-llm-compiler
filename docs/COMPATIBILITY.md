# Compatibility

This package treats Cypher compatibility as an explicit profile, not an implicit prompt instruction.

## Versioned Contracts

Stable public contracts:

- `cypher-llm-ir/v1`
- `cypher-llm-schema/v1`
- `cypher-llm-eval-dataset/v1`
- `cypher-llm-eval-attempts/v1`
- `cypher-llm-dialect-profile/v1`

JSON Schema artifacts live under `schemas/` and should be treated as the source of truth for model/tool input validation.

## Dialect Profiles

Checked-in profiles live under `profiles/`:

- `neo4j-cypher-25`: default stable profile.
- `opencypher-9`: preview profile for openCypher-style targets.
- `gql`: experimental forward-looking profile.

The current renderer defaults to LLM-safe Neo4j Cypher 25 behavior. Profiles currently document compatibility and rendering intent; future work should make every profile flag enforceable in validation and rendering.

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
