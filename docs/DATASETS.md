# Dataset Imports

This repository includes import tooling and small checked-in samples from upstream Cypher datasets. The samples are intentionally small so they can live in source control while proving the format and refresh path.

## Sources

### neo4j-labs/text2cypher

- Repository: `https://github.com/neo4j-labs/text2cypher`
- License: CC0-1.0
- Imported sample:
  - `examples/imported/text2cypher-gpt4o-sample.dataset.json`
  - `examples/imported/text2cypher-gpt4o-sample.attempts.json`
  - `examples/imported/text2cypher-gpt4o-sample.summary.json`
  - `examples/imported/text2cypher-gpt4o-sample.report.json`

The imported GPT-4o sample preserves upstream observed labels:

- `syntaxError`
- `timeout`
- `noCypher`
- `returnsResults`
- `hasExpectedAnswer`

The sample intentionally includes successful, no-result, timeout, syntax-error, and no-Cypher rows.

## Governance

Public benchmark datasets should carry:

- `source` on every task, pointing to the fixture, upstream row, or generation recipe.
- A split tag such as `split:train`, `split:validation`, `split:test`, `split:holdout`, or `split:smoke`.
- Source/license provenance documented in this file or encoded by a known source prefix.
- No emails, secret-looking tokens, or private-key material in questions, params, sources, or expected outputs.

Run the governance report before publishing:

```bash
node dist/src/cli.js dataset-governance \
  --dataset examples/eval-dataset.json \
  --report-out examples/benchmarks/tool-hash.dataset-governance.json \
  --fail-on-error
```

The report is machine-readable as `cypher-llm-dataset-governance/v1` and is validated in CI.

### neo4j-labs/text2cypher functional_cypher

- Repository: `https://github.com/neo4j-labs/text2cypher`
- License: CC0-1.0
- Imported sample:
  - `examples/imported/functional-cypher-sample.dataset.json`
  - `examples/imported/functional-cypher-sample.attempts.json`
  - `examples/imported/functional-cypher-sample.summary.json`
  - `examples/imported/functional-cypher-sample.report.json`

These rows include reference Cypher and are marked with `hasExpectedAnswer`.

### opencypher/openCypher TCK

- Repository: `https://github.com/opencypher/openCypher`
- License: Apache-2.0
- Imported sample:
  - `examples/imported/opencypher-tck-aggregation-sample.dataset.json`
  - `examples/imported/opencypher-tck-aggregation-sample.attempts.json`
  - `examples/imported/opencypher-tck-aggregation-sample.summary.json`
  - `examples/imported/opencypher-tck-aggregation-sample.report.json`

The checked-in sample uses a small subset of the Aggregation TCK feature as parser-backed syntax fixtures.

## Refresh Commands

Clone fresh upstream sources:

```bash
tmpdir=$(mktemp -d /tmp/cypher-fixtures.XXXXXX)
gh repo clone neo4j-labs/text2cypher "$tmpdir/text2cypher" -- --depth 1
gh repo clone opencypher/openCypher "$tmpdir/openCypher" -- --depth 1
```

Regenerate the checked-in imports:

```bash
npm run build

node dist/src/cli.js import-text2cypher \
  --csv "$tmpdir/text2cypher/datasets/synthetic_gpt4o_demodbs/text2cypher_gpt4o.csv" \
  --dataset-out examples/imported/text2cypher-gpt4o-sample.dataset.json \
  --attempts-out examples/imported/text2cypher-gpt4o-sample.attempts.json \
  --summary-out examples/imported/text2cypher-gpt4o-sample.summary.json \
  --dataset-name text2cypher-gpt4o-sample \
  --source neo4j-labs/text2cypher:datasets/synthetic_gpt4o_demodbs/text2cypher_gpt4o.csv \
  --model gpt-4o \
  --indexes 0,2,39,168,185

node dist/src/cli.js import-functional-cypher \
  --json "$tmpdir/text2cypher/datasets/functional_cypher/datas/parametric_trainer_with_repeats.json" \
  --dataset-out examples/imported/functional-cypher-sample.dataset.json \
  --attempts-out examples/imported/functional-cypher-sample.attempts.json \
  --summary-out examples/imported/functional-cypher-sample.summary.json \
  --dataset-name functional-cypher-sample \
  --source neo4j-labs/text2cypher:datasets/functional_cypher/datas/parametric_trainer_with_repeats.json \
  --model reference-cypher \
  --limit 3

node dist/src/cli.js import-opencypher-tck \
  --feature "$tmpdir/openCypher/tck/features/expressions/aggregation/Aggregation1.feature" \
  --dataset-out examples/imported/opencypher-tck-aggregation-sample.dataset.json \
  --attempts-out examples/imported/opencypher-tck-aggregation-sample.attempts.json \
  --summary-out examples/imported/opencypher-tck-aggregation-sample.summary.json \
  --dataset-name opencypher-tck-aggregation-sample \
  --source opencypher/openCypher:tck/features/expressions/aggregation/Aggregation1.feature \
  --model tck-reference \
  --limit 2
```

Regenerate baseline reports:

```bash
node dist/src/cli.js eval \
  --dataset examples/imported/text2cypher-gpt4o-sample.dataset.json \
  --attempts examples/imported/text2cypher-gpt4o-sample.attempts.json \
  --report-out examples/imported/text2cypher-gpt4o-sample.report.json

node dist/src/cli.js eval \
  --dataset examples/imported/functional-cypher-sample.dataset.json \
  --attempts examples/imported/functional-cypher-sample.attempts.json \
  --raw-cypher-can-execute \
  --report-out examples/imported/functional-cypher-sample.report.json

node dist/src/cli.js eval \
  --dataset examples/imported/opencypher-tck-aggregation-sample.dataset.json \
  --attempts examples/imported/opencypher-tck-aggregation-sample.attempts.json \
  --raw-cypher-can-execute \
  --report-out examples/imported/opencypher-tck-aggregation-sample.report.json

node dist/src/cli.js eval \
  --dataset examples/eval-dataset.json \
  --attempts examples/eval-attempts.json \
  --report-out examples/imported/smoke-ir-vs-raw.report.json \
  --default-limit 25 \
  --default-max-hops 5
```

## Baseline Metrics

The checked-in reports record the current baseline:

- `text2cypher-gpt4o-sample.report.json`: raw model attempts with upstream syntax-error, timeout, no-Cypher, returns-results, and no-results labels.
- `functional-cypher-sample.report.json`: reference Cypher attempts with expected-answer labels.
- `opencypher-tck-aggregation-sample.report.json`: openCypher TCK syntax/reference fixtures.
- `smoke-ir-vs-raw.report.json`: existing IR-vs-raw smoke comparison using the local fixture model.

These reports are not a final benchmark. They are the first durable fixture pipeline for scaling the benchmark.
