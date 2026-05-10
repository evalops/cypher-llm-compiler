# CypherBench

CypherBench is the benchmark layer for proving whether an LLM-facing Cypher workflow improved.

The first slice compares eval reports and produces repair-loop packets that can be fed back to a model retry.

## Compare Runs

Generate a baseline report:

```bash
cypher-llm eval \
  --dataset examples/eval-dataset.json \
  --attempts examples/benchmarks/tool-hash-raw-baseline.attempts.json \
  --report-out examples/benchmarks/tool-hash-raw-baseline.report.json \
  --default-limit 25 \
  --default-max-hops 5
```

Compare it against an IR-first run:

```bash
cypher-llm compare-evals \
  --baseline examples/benchmarks/tool-hash-raw-baseline.report.json \
  --candidate examples/imported/smoke-ir-vs-raw.report.json \
  --comparison-out examples/benchmarks/tool-hash-ir-vs-raw.comparison.json
```

The comparison marks metrics as `improved`, `regressed`, `unchanged`, or `info` based on whether higher or lower values are better for that metric.

Use `--fail-on-regression` in CI when a benchmark lane should block regressions.

## Scorecards

Publish a compact scorecard from one or more eval reports:

```bash
cypher-llm scorecard \
  --reports examples/benchmarks/tool-hash-raw-baseline.report.json,examples/imported/smoke-ir-vs-raw.report.json \
  --name tool-hash-scorecard \
  --scorecard-out examples/benchmarks/tool-hash.scorecard.json \
  --markdown-out examples/benchmarks/tool-hash.scorecard.md
```

The scorecard ranks lanes by pass rate, executable rate, and repair rate; aggregates diagnostics; and compares every candidate lane to the baseline report. JSON output validates against `schemas/cypherbench-scorecard.schema.json`, while markdown output is intended for release notes, READMEs, and benchmark dashboards.

## Dataset Governance

Audit a dataset before publishing or refreshing a benchmark lane:

```bash
cypher-llm dataset-governance \
  --dataset examples/eval-dataset.json \
  --report-out examples/benchmarks/tool-hash.dataset-governance.json \
  --fail-on-error
```

Governance reports validate against `schemas/dataset-governance.schema.json` and cover:

- Provenance source and inferred license.
- Split assignment through `split:*` tags.
- Missing source and missing split diagnostics.
- Duplicate task ids.
- Redaction findings for email, secret-looking token, and private-key patterns.

## Repair Loop

Generate model-targeted repair packets:

```bash
cypher-llm repair-loop \
  --dataset examples/eval-dataset.json \
  --attempts examples/benchmarks/tool-hash-raw-baseline.attempts.json \
  --feedback-out examples/benchmarks/tool-hash-raw-baseline.repair-loop.json \
  --default-limit 25 \
  --default-max-hops 5
```

Each packet contains:

- The original question.
- The schema contract for that task.
- The rendered attempt when available.
- Compiler diagnostic codes with retry-oriented suggestions.
- Failed eval expectations.
- A short instruction asking for corrected `CypherQuery` IR.

This gives agent loops a narrow repair context instead of sending a full transcript or a prose-only error message.

## Raw Lift Coverage

Measure how much of a legacy raw-Cypher attempt set can be migrated into structured IR:

```bash
cypher-llm lift-raw-eval \
  --dataset examples/imported/text2cypher-gpt4o-sample.dataset.json \
  --attempts examples/imported/text2cypher-gpt4o-sample.attempts.json \
  --summary-out examples/benchmarks/text2cypher-gpt4o-raw-lift.summary.json
```

The checked-in sample currently lifts all 3 raw attempts with no parser diagnostics. Use this as a small smoke lane before expanding to larger text2cypher slices.
