# Architecture

The package has one responsibility: convert LLM-authored structured Cypher intent into safe, deterministic Cypher text.

The flow is:

1. Normalize the graph schema into a machine-readable contract.
2. Accept a JSON IR query from an agent or tool.
3. Validate semantics against schema, scope, subquery import/export, procedure metadata, aggregation, parameter, and safety rules.
4. Apply bounded IR repairs when a mistake is deterministic.
5. Render canonical Cypher.
6. Produce an execution plan that can be run as `EXPLAIN`, read-only, or approval-required.

The implementation intentionally avoids database coupling. A database adapter can sit outside this package and consume the `SafeExecutionPlan`.
