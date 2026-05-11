# Years-Scale Roadmap

The multi-year ambition is to turn Cypher generation from prompt craft into infrastructure: a compiler, conformance suite, benchmark program, service boundary, safety planner, ecosystem surface, and governance model that LLM agents can depend on.

The public epics are:

- #10 Lossless Cypher parser and AST round-trip layer.
- #11 Dialect certification for Neo4j Cypher, openCypher, and GQL.
- #12 Public CypherBench model and compiler benchmark program.
- #13 Semantic proof and repair-planning engine.
- #14 Compiler service for agent runtimes and production graph apps.
- #15 Cost, cardinality, and safety policy planning.
- #16 Ecosystem layer for IDE, language-server, MCP, and agent feedback UX.
- #17 Release, standards, and compatibility governance.

## Machine-Readable Contract

The roadmap is exported from `src/years-roadmap.ts`, validated by `schemas/years-roadmap.schema.json`, and checked in at `examples/roadmap/cypher-llm-years-roadmap.json`.

Generate the JSON contract:

```bash
cypher-llm roadmap --roadmap-out examples/roadmap/cypher-llm-years-roadmap.json
```

Generate a markdown view:

```bash
cypher-llm roadmap --format markdown
```

The compatibility catalog is exported from `src/compatibility.ts`, validated by `schemas/compatibility-catalog.schema.json`, and checked in at `examples/governance/compatibility-catalog.json`.

```bash
cypher-llm compatibility --integrity --fail-on-error
```

Compatibility diff gates are exported from `src/compatibility-diff.ts`, validated by `schemas/compatibility-diff.schema.json`, and checked in at `examples/governance/compatibility-diff.json`.

```bash
cypher-llm compatibility-diff --baseline examples/governance/compatibility-catalog.json --fail-on-breaking
```

Contract conformance reports are exported from `src/contract-conformance.ts`, validated by `schemas/contract-conformance.schema.json`, and checked in at `examples/governance/contract-conformance.json`.

```bash
cypher-llm contract-conformance --fail-on-error
```

Lossless parse reports are the first executable parser/AST compatibility lane. They are exported from `src/lossless-parser.ts`, validated by `schemas/lossless-parse.schema.json`, and checked in at `examples/lossless/tool-hash.lossless.json`.

```bash
cypher-llm parse-lossless --schema examples/tool-hash.schema.json --cypher "MATCH (tool:Tool) RETURN tool"
```

Lossless conformance reports are exported from `src/lossless-conformance.ts`, validated by `schemas/lossless-conformance.schema.json`, and checked in at `examples/lossless/conformance.json`.

```bash
cypher-llm lossless-conformance --fail-on-fail
```

Dialect certification is the first executable certification lane under this program. It is exported from `src/dialect-certification.ts`, validated by `schemas/dialect-certification.schema.json`, and checked in at `examples/certification/dialect-certification.json`. Live database evidence is versioned separately by `schemas/dialect-live-evidence.schema.json` and checked in at `examples/certification/live-database-evidence.json`.

```bash
cypher-llm certify-dialects --fail-on-fail
cypher-llm certify-dialects --live-evidence examples/certification/live-database-evidence.json
```

Certification checks are separated into profile, renderer, parser, semantic, and live-database lanes. When live evidence is not supplied, the report emits a warning rather than pretending parser acceptance is the same as database evidence.

Proof-carrying compile output is the first semantic-proof lane. It is exported from `src/proof.ts`, validated by `schemas/cypher-proof.schema.json`, and checked in at `examples/proofs/tool-hash.proof.json`.

```bash
cypher-llm prove --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25
```

Proofs can also consume planner estimates, schema statistics, policy thresholds, and policy rules so the cost/safety claim and compact `policyEvidence` summary reflect the same evidence as standalone policy checks.

Repair plans are exported from `src/repair-plan.ts`, validated by `schemas/repair-plan.schema.json`, and checked in at `examples/proofs/tool-hash.repair-plan.json`.

```bash
cypher-llm repair-plan --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25
```

Repair plans can consume the same policy evidence, expose the same compact `policyEvidence` summary, classify blocking policy-rule diagnostics as unsafe steps, and attach source anchors to repair steps when their IR paths map back to lossless `cypherBefore` clauses.

Agent feedback packets wrap proof, repair-plan, policy evidence, and next-action guidance for LLM clients. They are exported from `src/agent-feedback.ts`, validated by `schemas/agent-feedback.schema.json`, and checked in at `examples/proofs/tool-hash.agent-feedback.json`.

```bash
cypher-llm agent-feedback --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25
```

Agent guides publish stable LLM-facing workflow rules, tool sequences, execution blockers, and diagnostic playbooks. They are exported from `src/agent-guide.ts`, validated by `schemas/agent-guide.schema.json`, and checked in at `examples/agent/agent-guide.json`.

```bash
cypher-llm agent-guide --format markdown
```

Diagnostic catalogs publish stable finding-code metadata for model repair loops. They are exported from `src/diagnostic-catalog.ts`, validated by `schemas/diagnostic-catalog.schema.json`, and checked in at `examples/diagnostics/diagnostic-catalog.json`.

```bash
cypher-llm diagnostic-catalog --integrity --fail-on-error
```

Cost and safety policy planning is exported from `src/policy.ts`, validated by `schemas/policy-report.schema.json`, and checked in at `examples/policy/tool-hash.policy.json`.

```bash
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json
```

Planner estimates are exported from `src/planner-estimate.ts`, validated by `schemas/planner-estimate.schema.json`, and checked in at `examples/policy/tool-hash.planner-estimate.json`.

```bash
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --planner-estimate examples/policy/tool-hash.planner-estimate.json
```

Schema statistics are exported from `src/schema-statistics.ts`, validated by `schemas/schema-statistics.schema.json`, and checked in at `examples/policy/tool-hash.schema-statistics.json`.

```bash
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --schema-statistics examples/policy/tool-hash.schema-statistics.json
```

Policy rules are exported from `src/policy-rules.ts`, validated by `schemas/policy-rules.schema.json`, and checked in at `examples/policy/tool-hash.policy-rules.json`.

```bash
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --policy-rules examples/policy/tool-hash.policy-rules.json
```

Policy profiles are exported from `src/policy-profile.ts`, validated by `schemas/policy-profile.schema.json`, and checked in at `examples/policy/policy-profiles.json`.

```bash
cypher-llm policy-profiles --profiles-out examples/policy/policy-profiles.json
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --policy-profile-id llm-readonly-strict
```

Dataset-level policy eval reports are exported from `src/policy-eval.ts`, validated by `schemas/policy-eval.schema.json`, and checked in at `examples/policy/tool-hash.policy-eval.json`.

```bash
cypher-llm policy-eval --dataset examples/eval-dataset.json --attempts examples/eval-attempts.json --policy-profile-id llm-readonly-strict --schema-statistics examples/policy/tool-hash.schema-statistics.json --policy-rules examples/policy/tool-hash.policy-rules.json
```

CypherBench scorecards are exported from `src/scorecard.ts`, validated by `schemas/cypherbench-scorecard.schema.json`, and checked in at `examples/benchmarks/tool-hash.scorecard.json`.

```bash
cypher-llm scorecard --reports examples/benchmarks/tool-hash-raw-baseline.report.json,examples/imported/smoke-ir-vs-raw.report.json
```

Benchmark gates are exported from `src/benchmark-gate.ts`, validated by `schemas/benchmark-gate.schema.json`, and checked in at `examples/benchmarks/tool-hash.benchmark-gate.json`.

```bash
cypher-llm benchmark-gate --baseline examples/benchmarks/tool-hash-raw-baseline.report.json --candidate examples/imported/smoke-ir-vs-raw.report.json --min-pass-rate 1 --min-executable-rate 0.3333
```

Retry eval reports are exported from `src/retry-eval.ts`, validated by `schemas/retry-eval.schema.json`, and checked in at `examples/benchmarks/tool-hash.retry-eval.json`.

```bash
cypher-llm retry-eval --dataset examples/eval-dataset.json --rounds examples/benchmarks/tool-hash-raw-baseline.attempts.json,examples/eval-attempts.json
```

Dataset governance reports are exported from `src/dataset-governance.ts`, validated by `schemas/dataset-governance.schema.json`, and checked in at `examples/benchmarks/tool-hash.dataset-governance.json`.

```bash
cypher-llm dataset-governance --dataset examples/eval-dataset.json --fail-on-error
```

Ecosystem diagnostics are exported from `src/lsp.ts`, validated by `schemas/lsp-diagnostics.schema.json`, and checked in at `examples/lsp/tool-hash.lsp.json`.

```bash
cypher-llm lsp-diagnostics --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json
```

Compiler service manifests are exported from `src/service-manifest.ts`, validated by `schemas/service-manifest.schema.json`, and checked in at `examples/service/service-manifest.json`. Runtime metrics are exported from `src/service-metrics.ts`, validated by `schemas/service-metrics.schema.json`, checked in at `examples/service/service-metrics.json`, and exposed by the HTTP service at `/v1/metrics`.

```bash
cypher-llm service-manifest --manifest-out examples/service/service-manifest.json
cypher-llm service-metrics --metrics-out examples/service/service-metrics.json
cypher-llm serve --require-auth --auth-token "$CYPHER_LLM_HTTP_TOKEN" --audit-log audit.jsonl
```

## Operating Rule

Years-scale work should still land as small verticals. Each vertical should add at least one of:

- A public issue or RFC.
- A machine-readable contract.
- A conformance fixture.
- A benchmark or regression gate.
- A production-facing API surface.
- A documented compatibility boundary.

That keeps the project ambitious without letting it dissolve into vibes.
