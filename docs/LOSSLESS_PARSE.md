# Lossless Parse Reports

Lossless parsing is the compatibility bridge for existing Cypher workloads. It lets agents inspect and target source ranges without rewriting a query first.

The first slice is a concrete syntax report, not a grammar-complete semantic AST. It preserves source bytes and exposes enough structure for migration, diagnostics, and repair planning.

## Contract

`parseCypherLosslessly(source, options?)` returns `cypher-llm-lossless-parse/v1`:

- `source` and `sourceHash`: original text and stable SHA-256 hash.
- `fragments`: source slices that reconstruct the input exactly.
- `trivia`: line and block comments with spans.
- `statements`: top-level statements with terminators and clause nodes.
- `sourceMap`: stable JSON-pointer anchors for fragments, trivia, statements, terminators, clauses, and lifted IR paths.
- `diagnostics`: delimiter and unterminated-token diagnostics with source paths.
- `parser`: optional Neo4j language-support parser result when a schema is supplied.
- `irPreview`: best-effort raw-to-IR preview for supported single-statement queries.

`roundTrip.ok` must stay true for any source the parser accepts into a report. Unsupported syntax should remain addressable as raw source, not disappear.

## CLI

```bash
cypher-llm parse-lossless \
  --schema examples/tool-hash.schema.json \
  --cypher 'MATCH (tool:Tool {name: $toolName})-[:`has MD5 hash`]->(hash:Hash) RETURN hash.value AS md5 LIMIT 10' \
  --report-out examples/lossless/tool-hash.lossless.json
```

Use `--no-ir-preview` when you only need source preservation and do not want the raw-lift bridge to run.

## Agent Use

Use lossless reports when an agent needs to:

- Inventory production Cypher without changing bytes.
- Attach diagnostics and repair plans to exact source spans.
- Map a source clause or comment back to a stable `sourceMap.sourcePath` and, when lifted, an `irPath`.
- Preserve comments and unsupported clauses during raw-to-IR migration.
- Decide whether a query can be lifted into `CypherQuery` IR or should remain raw.

For new generation, still prefer `CypherQuery` IR. Lossless parsing is for compatibility and migration.
