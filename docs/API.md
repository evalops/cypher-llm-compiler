# API Reference

## `normalizeSchema(schema)`

Builds lookup maps for labels, relationship types, aliases, properties, parameters, and escaped identifier metadata.

Use it once per graph schema and pass the normalized schema into validation, repair, and safety planning.

## `renderQuery(query, options?)`

Renders a `CypherQuery` into deterministic Cypher text.

Defaults:

- Schema identifiers are always backtick escaped.
- Map and property entries are sorted.
- Binary expressions are parenthesized.
- Clauses are separated by newlines.

## `validateQuery(query, schema, options?)`

Returns:

```ts
{
  ok: boolean;
  diagnostics: Diagnostic[];
}
```

Validation currently covers:

- Unknown labels and relationship types.
- Unknown properties when variable ownership can be inferred.
- Unknown parameters.
- Variables referenced out of scope.
- Relationship direction against declared endpoints.
- Missing `LIMIT` in LLM-safe read mode.
- Unbounded variable-length paths.
- Raw Cypher escape hatches.
- Write clauses in read-only mode.

## `repairQuery(query, schema, options?)`

Applies deterministic repairs over the structured IR:

- Canonicalize label and relationship aliases.
- Add a default `LIMIT`.
- Bound unbounded paths with `defaultMaxHops`.
- Flip relationship direction when schema endpoints make the repair unambiguous.

It returns the repaired query, diagnostics, and an ordered list of applied repairs.

## `repairRawCypher(raw, schema)`

Bootstrap bridge for existing text2cypher chains.

It intentionally does only narrow repairs:

- Quote known schema identifiers that require backticks.
- Flag SQL `BETWEEN`.
- Flag output that does not look like Cypher.

Use this to migrate legacy chains, not as the primary authoring path.

## `normalizeQuery(query)`

Renders canonical text for eval comparison. This is useful for golden tests where free-form whitespace and property ordering should not create false negatives.

## `equivalentQueries(left, right)`

Compares canonical render output.

## `createSafeExecutionPlan(query, schema, params?, options?)`

Produces a `SafeExecutionPlan`:

```ts
{
  mode: "explain" | "readonly" | "write-requires-approval";
  cypher: string;
  preflightCypher: string;
  params: Record<string, JsonLiteral>;
  diagnostics: Diagnostic[];
  repairs: RepairAction[];
  requiresApproval: boolean;
  canExecute: boolean;
  query: CypherQuery;
}
```

No database is touched. A real adapter can run `preflightCypher`, then use `canExecute` and `requiresApproval` to decide what to do next.

## `validateRenderedQueryWithParser(query, schema, options?)`

Renders a structured query and validates the resulting Cypher with Neo4j's `@neo4j-cypher/language-support` package.

Modes:

- `lint`: parser plus language-support linting.
- `syntax`: parser syntax diagnostics only.

The adapter maps Neo4j language-support diagnostics back into this package's stable `Diagnostic` shape.

## `validateCypherTextWithParser(cypher, schema, options?)`

Runs parser-backed validation directly on raw Cypher text. This is useful for migration from legacy text2cypher chains.

## `dbSchemaFromContract(schema)`

Converts a `CypherSchemaContract` into the `DbSchema` object expected by Neo4j language support. It includes both canonical and backtick-escaped identifier forms so rendered LLM-safe Cypher does not produce false missing-label warnings.

## `explainWithNeo4j(query, schema, session, params?, options?)`

Runs the compiler loop and then executes `EXPLAIN` through a Neo4j driver-compatible session.

The adapter accepts a small session interface rather than importing `neo4j-driver` directly:

```ts
{
  run(cypher, params): Promise<{ records?: unknown[]; summary?: unknown }>;
  executeRead?(work): Promise<unknown>;
}
```

Behavior:

- Builds a `SafeExecutionPlan`.
- Refuses to contact Neo4j when compiler diagnostics already block execution.
- Runs `EXPLAIN` with params when the plan is executable.
- Maps thrown Neo4j driver errors back into stable `Diagnostic` objects.

This lets applications bring their own driver/session lifecycle while the compiler owns preflight behavior.

## `evaluateFailureCorpus(cases?)`

Runs the known LLM failure fixtures and returns pass/fail records with canonical Cypher and diagnostic codes.

## `evaluateAttempts(dataset, attemptSet, options?)`

Scores an offline eval dataset against a set of model attempts.

Inputs:

- `EvalDataset`: task id, natural-language question, schema contract, optional params, and expectations.
- `EvalAttemptSet`: per-task model output as either structured IR or raw Cypher.

Output:

```ts
{
  version: "cypher-llm-eval-report/v1";
  datasetName: string;
  metrics: {
    totalTasks: number;
    passedTasks: number;
    passRate: number;
    executableRate: number;
    repairRate: number;
    diagnosticsByCode: Record<string, number>;
  };
  results: EvalResult[];
}
```

This is the main entrypoint for comparing raw text2cypher against compiler-mediated generation.
