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

## Operating Rule

Years-scale work should still land as small verticals. Each vertical should add at least one of:

- A public issue or RFC.
- A machine-readable contract.
- A conformance fixture.
- A benchmark or regression gate.
- A production-facing API surface.
- A documented compatibility boundary.

That keeps the project ambitious without letting it dissolve into vibes.
