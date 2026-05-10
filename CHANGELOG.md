# Changelog

## 0.1.0

- Added the initial Cypher LLM IR, schema contract, renderer, validator, repair loop, safety planner, and CLI.
- Added JSON Schema contracts for the IR, schema contract, eval datasets, eval attempts, and dialect profiles.
- Added offline eval runner, parser-backed validation through Neo4j language support, and a driver-compatible Neo4j `EXPLAIN` adapter.
- Added dialect profiles for Neo4j Cypher 25, openCypher 9, and a GQL-oriented target.
- Added raw Cypher lifting, schema introspection, CypherBench comparison/repair-loop artifacts, semantic type diagnostics, function/procedure argument checks, and dialect feature validation.
- Added years-scale public roadmap governance with GitHub issue-backed workstreams, capability status, JSON Schema, CLI output, and checked-in roadmap artifact.
- Added dialect certification reports with profile metadata, renderer, parser, semantic feature-gate, known-limitation checks, JSON Schema, CLI output, and checked-in certification artifact.
- Added proof-carrying compile output with repair, parser, diagnostics, execution-policy claims, JSON Schema, CLI/tool output, and checked-in proof artifact.
- Added a JSON HTTP compiler service over the shared tool dispatcher with health, metadata, tool, roadmap, and dialect certification routes.
- Added static cost and safety policy reports for broad scans, traversal risk, high limits, cartesian patterns, and writes, including CLI/tool/service output and checked-in policy artifact.
- Added LSP-style diagnostics and code actions over compiler, parser, policy, and repair output, including CLI/tool/service output and checked-in LSP artifact.
- Added lossless Cypher parse reports with exact source round-trip fragments, comments, statement/clause spans, optional parser output, IR-preview mapping, JSON Schema, CLI/tool/service output, and checked-in lossless artifact.
- Added CypherBench scorecards with ranked lanes, aggregate diagnostics, baseline comparisons, JSON Schema, markdown rendering, CLI/tool/service output, and checked-in scorecard artifacts.
- Added CypherBench dataset governance reports with provenance, split assignment, redaction findings, duplicate-id diagnostics, JSON Schema, CLI/tool/service output, and checked-in governance artifact.
