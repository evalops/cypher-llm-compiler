# Neo4j Live EXPLAIN Fixture

The normal test suite includes `test/neo4j-live.test.ts`, but it skips unless Neo4j connection env vars are present. This keeps local development fast while letting CI prove the compiler output with a real server.

## Local Run

Start Neo4j:

```bash
docker compose -f docker-compose.neo4j.yml up -d
```

Wait for Bolt connectivity:

```bash
CYPHER_LLM_NEO4J_PASSWORD=cypherllm npm run neo4j:wait
```

Run the live fixture:

```bash
CYPHER_LLM_NEO4J_URI=bolt://localhost:7687 \
CYPHER_LLM_NEO4J_USER=neo4j \
CYPHER_LLM_NEO4J_PASSWORD=cypherllm \
npm run test:live:neo4j
```

The same env vars also enable the live fixture inside `npm test`.

The checked-in evidence artifact lives at `examples/certification/live-database-evidence.json`. CI asserts that its Neo4j Cypher 25 evidence query matches the representative query that the live fixture sends through Neo4j `EXPLAIN`, and `certify-dialects --live-evidence examples/certification/live-database-evidence.json` folds that evidence into the public dialect certification report.

## Env Vars

- `CYPHER_LLM_NEO4J_URI`: Bolt URI. Defaults to `bolt://localhost:7687` for `npm run neo4j:wait`.
- `CYPHER_LLM_NEO4J_USER`: Username. Defaults to `neo4j`.
- `CYPHER_LLM_NEO4J_PASSWORD`: Required password.
- `CYPHER_LLM_NEO4J_WAIT_MS`: Optional wait timeout for `npm run neo4j:wait`; defaults to `120000`.

## CI

`.github/workflows/ci.yml` starts `neo4j:5-community` as a GitHub Actions service, waits for Bolt connectivity, runs `npm test` with the env vars set, then runs `npm run verify:pack`.

## Troubleshooting

- If `neo4j:wait` times out, check that port `7687` is not already in use and that Docker has enough memory for the container.
- If authentication fails, remove an old local volume or restart with the password from `docker-compose.neo4j.yml`.
- If the live test is skipped locally, confirm `CYPHER_LLM_NEO4J_URI` and `CYPHER_LLM_NEO4J_PASSWORD` are exported in the same shell running the test.
- The fixture uses `EXPLAIN`, so it does not require seeded graph data.
