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

Dialect certification is the first executable certification lane under this program. It is exported from `src/dialect-certification.ts`, validated by `schemas/dialect-certification.schema.json`, and checked in at `examples/certification/dialect-certification.json`.

```bash
cypher-llm certify-dialects --fail-on-fail
```

Proof-carrying compile output is the first semantic-proof lane. It is exported from `src/proof.ts`, validated by `schemas/cypher-proof.schema.json`, and checked in at `examples/proofs/tool-hash.proof.json`.

```bash
cypher-llm prove --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json --params examples/tool-hash.params.json --default-limit 25
```

Cost and safety policy planning is exported from `src/policy.ts`, validated by `schemas/policy-report.schema.json`, and checked in at `examples/policy/tool-hash.policy.json`.

```bash
cypher-llm policy-check --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json
```

Ecosystem diagnostics are exported from `src/lsp.ts`, validated by `schemas/lsp-diagnostics.schema.json`, and checked in at `examples/lsp/tool-hash.lsp.json`.

```bash
cypher-llm lsp-diagnostics --schema examples/tool-hash.schema.json --query examples/tool-hash.query.json
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
