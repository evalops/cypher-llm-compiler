# Neo4j Schema Introspection

`introspectNeo4jSchema(session, options?)` builds a `CypherSchemaContract` from a live Neo4j database using a small driver-compatible session interface.

The adapter currently discovers:

- Node labels from `db.schema.nodeTypeProperties()` and sampled relationship endpoints.
- Relationship types from `db.schema.relTypeProperties()` and sampled relationship endpoints.
- Node and relationship properties, mapped into Cypher type names.
- Relationship endpoint labels from a bounded `MATCH (from)-[rel]->(to)` sample.
- Procedure descriptions and yielded variables from `SHOW PROCEDURES`.

## CLI

```bash
cypher-llm introspect-neo4j \
  --uri bolt://localhost:7687 \
  --user neo4j \
  --password "$NEO4J_PASSWORD" \
  --schema-out schema.json \
  --sample-limit 1000
```

Use `--no-procedures` when the database user does not have permission to run `SHOW PROCEDURES` or when the procedure catalog should not be exposed to an agent.

## Redaction

The adapter emits structural metadata, not data rows. For production graphs, run it with a database role that already reflects the labels, relationship types, and procedures the agent is allowed to see. If a graph has sensitive label or property names, redact or alias them before passing the contract to a model.

## Endpoint Sampling

Relationship endpoints are inferred with a bounded sample because Neo4j schema procedures expose relationship types and properties but not every observed label-pair endpoint in one portable shape.

Increase `--sample-limit` for sparse graphs. For heavily multi-label graphs, treat endpoint lists as observed hints rather than a complete ontology.
