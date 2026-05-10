# Repair Loop

The intended LLM loop is:

1. Ask the model for `CypherQuery` JSON, not raw Cypher.
2. Validate the query.
3. Send stable diagnostics back to the model if repair needs judgment.
4. Apply deterministic local repairs when they are safe.
5. Render and execute only after diagnostics are clean enough for the selected safety mode.

Raw-Cypher repair exists only as a bootstrap bridge for existing chains. It is intentionally narrow because regex correction over a query language is a trap: useful for a known relationship type with spaces, unsafe as a general compiler.
