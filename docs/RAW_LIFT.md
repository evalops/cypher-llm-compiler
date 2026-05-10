# Raw Cypher Lifting

Raw lifting is the migration bridge from legacy text2cypher chains into `CypherQuery` IR.

It is intentionally a subset parser, not a replacement for Neo4j's parser. The goal is to lift common read-query shapes into structured IR, render canonical Cypher, and leave everything else as an explicit `raw` clause with stable diagnostics.

## Supported Shapes

The first slice supports:

- `MATCH` and `OPTIONAL MATCH` node patterns.
- One-hop relationship patterns with direction, type, properties, and variable-length ranges.
- Named paths such as `p = (a)-[*1..3]->(b)`.
- `WHERE` expressions for common binary predicates.
- `WITH` and `RETURN` projections with aliases.
- `ORDER BY`, `SKIP`, and `LIMIT`.
- Procedure calls shaped as `CALL db.labels() YIELD label`.
- Parameters, literals, variables, property access, function calls, and raw expression fallback.

Unsupported syntax is preserved as:

```json
{
  "kind": "raw",
  "cypher": "MATCH (a) USING INDEX a:Person(name) RETURN a",
  "reason": "raw-lift-failed"
}
```

The diagnostic code is `raw-lift-unsupported-clause`, with a `rewrite-as-ir` repair hint.

## CLI

Lift one query and write both the structured query and summary:

```bash
cypher-llm lift-raw \
  --schema examples/tool-hash.schema.json \
  --cypher 'MATCH (tool:Tool {name: $toolName})-[:has MD5 hash]->(hash:Hash) RETURN hash.value AS md5 LIMIT 10' \
  --query-out examples/benchmarks/tool-hash-lifted.query.json \
  --summary-out examples/benchmarks/tool-hash-lifted.summary.json
```

Evaluate raw lifting over imported attempts:

```bash
cypher-llm lift-raw-eval \
  --dataset examples/imported/text2cypher-gpt4o-sample.dataset.json \
  --attempts examples/imported/text2cypher-gpt4o-sample.attempts.json \
  --summary-out examples/benchmarks/text2cypher-gpt4o-raw-lift.summary.json
```

The eval report counts raw attempts, fully lifted attempts, partially lifted attempts, unsupported attempts, and diagnostic codes.

## Validation

When a schema is supplied, `liftRawCypherToIr` validates the rendered output with Neo4j language support. This matters because raw input may be invalid for reasons the compiler can repair while lifting, such as a relationship type that needs backticks.

`parserOk: true` means the lifted, rendered Cypher passed parser validation.

## Intended Use

Use raw lifting to:

- Inventory how much of an existing text2cypher corpus can become structured IR.
- Create migration fixtures from known raw outputs.
- Feed unsupported clause diagnostics back into a model retry that asks for `CypherQuery` JSON.

Do not use raw lifting as the long-term authoring path. New agents should emit `CypherQuery` directly.
