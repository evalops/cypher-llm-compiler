# Schema Contract

LLMs should not receive graph schemas as prose when the execution layer can provide structured data.

The schema contract includes:

- Node labels and aliases.
- Relationship types, aliases, direction, and allowed endpoints.
- Property names, aliases, types, nullability, and sample values.
- Declared parameters and expected types.
- Optional path templates for common traversals.

The renderer uses this contract to escape identifiers. The validator uses it to detect unknown labels, unknown relationship types, property drift, invalid directions, and parameter mismatches.
