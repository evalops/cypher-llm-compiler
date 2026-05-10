# Schema Contract

LLMs should not receive graph schemas as prose when the execution layer can provide structured data.

The schema contract includes:

- Node labels and aliases.
- Relationship types, aliases, direction, and allowed endpoints.
- Property names, aliases, types, nullability, and sample values.
- Declared parameters and expected types.
- Optional procedure metadata, including arguments and yielded variables.
- Optional function metadata, including arguments and return type.
- Optional path templates for common traversals.

The renderer uses this contract to escape identifiers. The validator uses it to detect unknown labels, unknown relationship types, property drift, invalid directions, property and parameter type mismatches, comparison type mismatches, procedure argument and `YIELD` drift, and function argument drift when metadata is present.

Contracts can be hand-authored or generated from Neo4j with `cypher-llm introspect-neo4j`; see `docs/NEO4J_INTROSPECTION.md`.
