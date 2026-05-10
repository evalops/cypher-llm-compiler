# Evals

This repo treats LLM failures as product fixtures.

Current corpus categories:

- Relationship identifier escaping.
- Direction guessing.
- Scope drift across `WITH`.
- SQL syntax leakage.
- Unbounded traversal.

The corpus runner keeps both pre-repair and post-repair diagnostic codes. This matters because some deterministic repairs are useful precisely because the original failure was detected.

Recommended external eval loop:

1. Generate `CypherQuery` IR from natural-language tasks.
2. Run `repairQuery`.
3. Run `validateQuery`.
4. Record diagnostic codes by model, prompt, schema, and task.
5. Render canonical Cypher.
6. Run database `EXPLAIN`.
7. Map database errors back into diagnostics.
8. Add every recurring failure to `llmFailureCorpus`.

The target metric is not only "valid Cypher percentage." It is:

- Valid render rate.
- Clean diagnostic rate.
- Deterministic repair rate.
- Approval-required write detection rate.
- Runtime `EXPLAIN` pass rate.
- Result correctness, when answer fixtures exist.
