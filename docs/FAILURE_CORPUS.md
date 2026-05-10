# Failure Corpus

The failure corpus captures mistakes that repeatedly appear when LLMs generate Cypher:

- Relationship types with spaces are emitted without backticks.
- Relationship direction is guessed from language instead of schema.
- Variables are referenced after being dropped by `WITH`.
- Aggregate expressions are mixed into invalid scopes.
- SQL idioms such as `BETWEEN` appear in Cypher.
- Variable-length paths are left unbounded.
- The model returns explanation text instead of a query.

Each fixture should have one of two outcomes:

- A deterministic repair that produces canonical Cypher.
- A diagnostic with a stable code that can be sent back to the model.
