# Evals

This repo treats LLM failures as product fixtures.

Current corpus categories:

- Relationship identifier escaping.
- Direction guessing.
- Scope drift across `WITH`.
- SQL syntax leakage.
- Unbounded traversal.

The corpus runner keeps both pre-repair and post-repair diagnostic codes. This matters because some deterministic repairs are useful precisely because the original failure was detected.

## Offline Dataset Runner

The longer-horizon eval surface is now represented by two JSON files:

- `cypher-llm-eval-dataset/v1`: tasks with natural-language questions, schema contracts, params, tags, and expectations.
- `cypher-llm-eval-attempts/v1`: model outputs as either `CypherQuery` IR or legacy raw Cypher.

Run the checked-in smoke set:

```bash
cypher-llm eval \
  --dataset examples/eval-dataset.json \
  --attempts examples/eval-attempts.json \
  --default-limit 25 \
  --default-max-hops 5
```

The report includes:

- `passRate`: fraction of tasks whose expectations passed.
- `executableRate`: fraction that produced executable safe plans.
- `repairRate`: fraction of attempted tasks that needed deterministic repair.
- `diagnosticsByCode`: stable failure taxonomy counts.
- per-task canonical Cypher, diagnostics, repairs, and expectation checks.

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
