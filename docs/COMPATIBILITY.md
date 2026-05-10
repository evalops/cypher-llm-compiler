# Compatibility

This package treats Cypher compatibility as an explicit profile, not an implicit prompt instruction.

## Versioned Contracts

Stable public contracts:

- `cypher-llm-ir/v1`
- `cypher-llm-schema/v1`
- `cypher-llm-diagnostic/v1`
- `cypher-llm-eval-dataset/v1`
- `cypher-llm-eval-attempts/v1`
- `cypher-llm-dialect-profile/v1`
- `cypher-llm-dialect-certification/v1`
- `cypher-llm-proof/v1`
- `cypher-llm-planner-estimate/v1`
- `cypher-llm-schema-statistics/v1`
- `cypher-llm-policy-rules/v1`
- `cypher-llm-policy-report/v1`
- `cypher-llm-policy-profile-catalog/v1`
- `cypher-llm-lsp-diagnostics/v1`
- `cypher-llm-lossless-parse/v1`
- `cypher-llm-cypherbench-scorecard/v1`
- `cypher-llm-benchmark-gate/v1`
- `cypher-llm-dataset-governance/v1`
- `cypher-llm-repair-plan/v1`
- `cypher-llm-agent-feedback/v1`
- `cypher-llm-agent-guide/v1`
- `cypher-llm-diagnostic-catalog/v1`
- `cypher-llm-service-manifest/v1`
- `cypher-llm-years-roadmap/v1`
- `cypher-llm-compatibility-catalog/v1`
- `cypher-llm-compatibility-diff/v1`

JSON Schema artifacts live under `schemas/` and should be treated as the source of truth for model/tool input validation.

## Compatibility Catalog

Run:

```bash
cypher-llm compatibility --integrity --fail-on-error --catalog-out examples/governance/compatibility-catalog.json
```

Compatibility catalogs are the machine-readable governance contract for public versions. They define stability levels, contract categories, schema and example evidence, sha256 fingerprints for contract files, release gates, certification gates, and deprecation policy. JSON output validates against `schemas/compatibility-catalog.schema.json`.

## Compatibility Diff Gates

Run:

```bash
cypher-llm compatibility-diff --baseline examples/governance/compatibility-catalog.json --fail-on-breaking
```

Compatibility diff reports compare a baseline catalog against a candidate catalog or the current runtime catalog. They classify added, removed, and changed contracts, contract fingerprints, release gates, certification gates, and deprecation-policy fields as `info`, `warning`, or `breaking`. JSON output validates against `schemas/compatibility-diff.schema.json`.

## Contract Conformance

Run:

```bash
cypher-llm contract-conformance --fail-on-error --report-out examples/governance/contract-conformance.json
```

Contract conformance reports are the release-agent checklist for public contracts. They verify that schema files, example files, evidence paths, fingerprints, and schema validation all agree with the compatibility catalog. JSON output validates against `schemas/contract-conformance.schema.json`.

## Agent Guide

Run:

```bash
cypher-llm agent-guide --guide-out examples/agent/agent-guide.json
```

Agent guides are the machine-readable client contract for how LLMs should use the compiler. They publish authoring rules, default limits, workflow steps, execution blockers, diagnostic playbooks, public contract pins, and example paths. JSON output validates against `schemas/agent-guide.schema.json`.

## Diagnostic Catalog

Run:

```bash
cypher-llm diagnostic-catalog --integrity --fail-on-error --catalog-out examples/diagnostics/diagnostic-catalog.json
```

Diagnostic catalogs are the machine-readable repair contract for stable compiler, parser, policy, dataset, service, and runtime finding codes. They publish severity, source, category, preferred action, preferred tool, model instruction, and code-owner evidence so LLM clients can route failures without scraping prose. JSON output validates against `schemas/diagnostic-catalog.schema.json`.

## Dialect Profiles

Checked-in profiles live under `profiles/`:

- `neo4j-cypher-25`: default stable profile.
- `opencypher-9`: preview profile for openCypher-style targets.
- `gql`: experimental forward-looking profile.

The current renderer defaults to LLM-safe Neo4j Cypher 25 behavior. Validation now enforces core feature flags such as `LET`, subqueries, write clauses, path modes, shortest path modes, and GQL range-rendering limitations. `renderQueryForDialect` applies profile rendering rules that are currently safe to express in the text renderer.

Known boundary: the GQL profile records desired relationship quantifier behavior, but the renderer still emits legacy star syntax. Validation reports `dialect-rendering-limitation` when that boundary matters.

## Certification Reports

Run:

```bash
cypher-llm certify-dialects --fail-on-fail --report-out examples/certification/dialect-certification.json
```

The report checks profile metadata, schema identifier escaping, parser acceptance for rendered reads, semantic feature gates for `LET` and path modes, and known relationship range rendering limitations. Warnings are allowed for documented experimental boundaries such as the current GQL range syntax limitation; failures indicate a profile claim is not enforced by code.

## Proof Objects

Run:

```bash
cypher-llm prove --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25 --proof-out examples/proofs/tool-hash.proof.json
```

Proofs are compact compile artifacts for agents. They include the rendered Cypher, `EXPLAIN` preflight, deterministic repair kinds, diagnostic codes, parser preflight status, execution-policy claims, and `policyEvidence` summary. Planner estimates, schema statistics, policy thresholds, and policy rules can feed the cost/safety proof claim. A blocked proof is not safe to execute without resolving its failed claims.

## Repair Plans

Run:

```bash
cypher-llm repair-plan --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25 --plan-out examples/proofs/tool-hash.repair-plan.json
```

Repair plans are ranked agent feedback objects. Deterministic steps include JSON-patch-like operations that the compiler can apply directly, model-required steps contain diagnostics that need regenerated IR, and unsafe steps hold policy or approval blockers. Steps also include `sourceAnchor` data when their IR path maps back to a lossless clause span in `cypherBefore`. Planner estimates, schema statistics, policy thresholds, and policy rules can feed the unsafe blocker list and `policyEvidence` summary so policy failures do not get misclassified as ordinary model edits.

## Agent Feedback

Run:

```bash
cypher-llm agent-feedback --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25 --feedback-out examples/proofs/tool-hash.agent-feedback.json
```

Agent feedback packets are the one-call contract for LLM clients. They include the proof object, repair plan, compact policy evidence, aggregate diagnostic codes, catalog-backed diagnostic actions, repair kinds, and a `nextAction` field that tells the client whether to execute, apply deterministic repairs, regenerate IR, request approval, or stop.

## Service Manifests

Run:

```bash
cypher-llm service-manifest --manifest-out examples/service/service-manifest.json
```

Service manifests are the public runtime contract for the HTTP compiler service. They list stable routes, body-size limits, bearer-auth posture, public discovery routes, audit redaction fields, and data-boundary guarantees. JSON output validates against `schemas/service-manifest.schema.json`.

## Policy Reports

Run:

```bash
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --report-out examples/policy/tool-hash.policy.json
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --planner-estimate examples/policy/tool-hash.planner-estimate.json --schema-statistics examples/policy/tool-hash.schema-statistics.json --policy-rules examples/policy/tool-hash.policy-rules.json --report-out policy-with-evidence.json
```

Policy reports are static pre-execution checks for broad scans, cartesian pattern risk, missing or high return limits, unbounded or high-hop traversals, schema-statistics risk, policy-rule risk, planner-estimated cost, and write risk. They complement parser and semantic validation: a query can be syntactically valid but still too broad or expensive for an autonomous agent to run.

## Planner Estimates

Planner estimates are optional machine-readable `EXPLAIN` or fixture evidence for policy checks. They capture max estimated rows, db hits, and nested operator names. JSON estimates validate against `schemas/planner-estimate.schema.json` and can be passed to policy checks through `--planner-estimate` or the `plannerEstimate` tool argument.

## Schema Statistics

Schema statistics are optional cardinality, index, and relationship-fanout metadata for policy checks. JSON statistics validate against `schemas/schema-statistics.schema.json` and can be passed to policy checks through `--schema-statistics` or the `schemaStatistics` tool argument.

## Policy Rules

Policy rules are optional tenant-scope and sensitive-data constraints for policy checks. JSON rule sets validate against `schemas/policy-rules.schema.json` and can be passed to policy checks through `--policy-rules` or the `policyRules` tool argument.

## Policy Profiles

Run:

```bash
cypher-llm policy-profiles --profiles-out examples/policy/policy-profiles.json
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --policy-profile-id llm-readonly-strict
```

Policy profile catalogs are named cost and safety presets for agent runtimes. Built-in profiles cover strict read-only, wider read-only exploration, and externally approved write-maintenance paths. Policy reports record the applied profile id and title so runtime policy choices are auditable.

## LSP Diagnostics

Run:

```bash
cypher-llm lsp-diagnostics --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --uri file:///examples/tool-hash.query.json --report-out examples/lsp/tool-hash.lsp.json
```

LSP diagnostic reports adapt compiler, parser, policy, and repair output into the shape expected by editor surfaces and agent UIs: diagnostics carry ranges, severities, codes, and data, while code actions expose quick fixes, deterministic repair previews, and raw-Cypher text edits when a repair can be applied to exact source ranges.

## Lossless Parse Reports

Run:

```bash
cypher-llm parse-lossless --schema examples/tool-hash.schema.json --cypher "MATCH (tool:Tool) RETURN tool" --report-out examples/lossless/tool-hash.lossless.json
```

Lossless parse reports preserve exact source fragments, comments, statement and clause spans, source-map anchors, delimiter diagnostics, optional parser output, and best-effort IR-preview coverage. This is the first compatibility contract for existing Cypher workloads that must not be rewritten just to be inspected by an LLM agent.

## CypherBench Scorecards

Run:

```bash
cypher-llm scorecard --reports baseline.report.json,candidate.report.json --scorecard-out scorecard.json --markdown-out scorecard.md
```

Scorecards are the public benchmark contract for ranked eval lanes, aggregate diagnostics, and baseline comparisons. JSON scorecards validate against `schemas/cypherbench-scorecard.schema.json`; markdown scorecards are generated from the same object.

## Benchmark Gates

Run:

```bash
cypher-llm benchmark-gate --baseline baseline.report.json --candidate candidate.report.json --min-pass-rate 0.95 --gate-out gate.json --fail-on-fail
```

Benchmark gates are the CI contract for blocking regressions. They wrap an eval comparison, directional metric regression checks, optional pass-rate and executable-rate floors, optional diagnostic-regression checks, and a pass/fail summary. JSON gates validate against `schemas/benchmark-gate.schema.json`.

## Dataset Governance Reports

Run:

```bash
cypher-llm dataset-governance --dataset examples/eval-dataset.json --report-out governance.json --fail-on-error
```

Governance reports are the public dataset-readiness contract for provenance, split assignment, duplicate task ids, and redaction findings. JSON reports validate against `schemas/dataset-governance.schema.json`.

## Breaking Changes

Breaking changes require:

- A new contract version or explicit migration note.
- Updated JSON Schema.
- Updated examples.
- Changelog entry.
- Test coverage showing old/new behavior where feasible.

## Packaging

Run:

```bash
npm run verify:pack
```

The package artifact should include compiled `dist/src` output, docs, examples, profiles, schemas, `README.md`, and `CHANGELOG.md`.
