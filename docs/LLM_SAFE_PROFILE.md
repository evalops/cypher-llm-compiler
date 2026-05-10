# LLM-Safe Cypher Profile

The LLM-safe profile is a conservative rendering and validation profile for generated Cypher.

Rules:

- Schema identifiers are backtick-escaped by default.
- Variables and aliases must be explicit.
- `RETURN` without `LIMIT` is repaired or warned about in read-only mode.
- Variable-length paths without a max hop count are warnings by default.
- Write clauses are approval-required unless explicitly enabled by the caller.
- Relationship direction is checked against the schema contract when labels are known.
- Raw Cypher snippets are allowed only as explicit escape hatches and are reported in diagnostics.

The point is not to make Cypher smaller. The point is to make the valid subset more legible to both the model and the compiler loop around it.
