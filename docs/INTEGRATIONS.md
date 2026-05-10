# Agent Integrations

The compiler exposes the same nineteen operations across OpenAI tool schemas, MCP, HTTP, LangChain-shaped adapters, and the CLI:

- `cypher_render`: repair IR, validate, and return a `SafeExecutionPlan`.
- `cypher_validate`: return stable compiler diagnostics for IR.
- `cypher_repair`: repair structured IR or narrow legacy raw Cypher failures.
- `cypher_repair_plan`: return ranked deterministic, model-required, and unsafe repair plan steps, including optional policy evidence, thresholds, and a compact `policyEvidence` summary.
- `cypher_parse_lossless`: preserve raw Cypher byte-for-byte while exposing comments, clauses, source spans, source-map anchors, parser output, and IR-preview coverage.
- `cypher_parse_check`: run Neo4j language-support parser validation.
- `cypher_policy_check`: assess static cost, cardinality, schema-statistics, policy-rule, planner-estimate, and safety policy.
- `cypher_policy_profiles`: list built-in policy profiles for audited autonomous-agent safety settings.
- `cypher_lsp_diagnostics`: emit LSP-style diagnostics and code actions, including raw-Cypher text edits when repairs can be applied to exact source ranges.
- `cypher_prove`: return proof-carrying compile output with repairs, diagnostics, parser preflight, execution-policy claims, optional policy evidence and thresholds, and a compact `policyEvidence` summary.
- `cypher_agent_feedback`: return proof, repair plan, policy evidence, and the next action an LLM client should take.
- `cypher_agent_guide`: return LLM-facing authoring rules, tool sequences, execution blockers, and diagnostic playbooks.
- `cypher_diagnostic_catalog`: return stable diagnostic-code metadata, severity, source, preferred action, and model repair instructions.
- `cypher_compatibility_catalog`: return public contract versions, compatibility levels, fingerprints, release gates, certification gates, and deprecation policy.
- `cypher_compatibility_diff`: compare compatibility catalogs and classify release-impacting contract changes.
- `cypher_contract_conformance`: verify public schemas, examples, fingerprints, schema validation, and evidence paths.
- `cypher_eval`: score model attempts against an eval dataset.
- `cypher_scorecard`: publish ranked CypherBench scorecards from eval reports.
- `cypher_benchmark_gate`: publish pass/fail CypherBench regression gates for CI.
- `cypher_dataset_governance`: audit benchmark datasets for provenance, splits, duplicate ids, and redaction findings.

## OpenAI Tools

Use `getOpenAiResponsesTools()` with the Responses API shape, or `getOpenAiChatTools()` with the chat-completions function shape.

```ts
import {
  executeCypherCompilerTool,
  getOpenAiResponsesTools
} from "@evalops/cypher-llm-compiler";

const tools = getOpenAiResponsesTools();

// When the model returns a function call:
const output = await executeCypherCompilerTool(call.name, JSON.parse(call.arguments));
```

The exported tool schemas intentionally ask for `CypherQuery` IR instead of raw Cypher wherever possible. Raw Cypher remains available for migration and inventory through `cypher_parse_lossless`, `cypher_repair`, and `cypher_parse_check`.

## MCP

Run the stdio server:

```bash
cypher-llm-mcp
```

or:

```bash
cypher-llm mcp
```

The server supports:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`

Example `tools/call` request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "cypher_render",
    "arguments": {
      "schema": {
        "version": "cypher-llm-schema/v1",
        "nodes": [{ "name": "Tool" }, { "name": "Hash" }],
        "relationships": [{ "type": "has MD5 hash", "from": "Tool", "to": "Hash" }]
      },
      "query": {
        "version": "cypher-llm-ir/v1",
        "profile": "llm-safe-readonly",
        "clauses": [
          {
            "kind": "match",
            "patterns": [
              {
                "segments": [
                  { "variable": "tool", "labels": ["Tool"] },
                  {
                    "rel": { "types": ["has MD5 hash"], "direction": "out" },
                    "node": { "variable": "hash", "labels": ["Hash"] }
                  }
                ]
              }
            ]
          },
          {
            "kind": "return",
            "items": [{ "expression": { "kind": "var", "name": "hash" } }]
          }
        ]
      },
      "defaultLimit": 25
    }
  }
}
```

## HTTP Service

Run the local JSON service:

```bash
cypher-llm serve --host 127.0.0.1 --port 8787
```

For an agent-runtime boundary with bearer auth and redacted JSONL audit events:

```bash
cypher-llm serve --host 127.0.0.1 --port 8787 --require-auth --auth-token "$CYPHER_LLM_HTTP_TOKEN" --audit-log audit.jsonl
```

Routes:

- `GET /healthz`
- `GET /v1/service-manifest`
- `GET /v1/tools`
- `POST /v1/render`
- `POST /v1/validate`
- `POST /v1/repair`
- `POST /v1/repair-plan`
- `POST /v1/parse-lossless`
- `POST /v1/parse-check`
- `POST /v1/policy`
- `POST /v1/policy-profiles`
- `POST /v1/lsp-diagnostics`
- `POST /v1/prove`
- `POST /v1/agent-feedback`
- `GET /v1/agent-guide`
- `POST /v1/agent-guide`
- `GET /v1/diagnostic-catalog`
- `POST /v1/diagnostic-catalog`
- `GET /v1/compatibility`
- `POST /v1/compatibility`
- `POST /v1/compatibility-diff`
- `GET /v1/contract-conformance`
- `POST /v1/contract-conformance`
- `POST /v1/eval`
- `POST /v1/scorecard`
- `POST /v1/benchmark-gate`
- `POST /v1/dataset-governance`
- `POST /v1/tools/:toolName`
- `GET /v1/roadmap`
- `GET /v1/dialect-certification`

`GET /v1/service-manifest` returns `cypher-llm-service-manifest/v1`, including route auth requirements, body limits, audit redaction fields, and data-boundary guarantees. When auth is configured, `/healthz` and `/v1/service-manifest` remain public for discovery and liveness while runtime routes require `Authorization: Bearer <token>`.

Use this when an agent runtime needs a process boundary instead of an in-process TypeScript import or stdio MCP server.

## LangChain

The LangChain adapter has no hard LangChain dependency. It returns Runnable/Tool-shaped objects that can be wrapped by the application.

```ts
import { createLangChainCypherAdapter } from "@evalops/cypher-llm-compiler";

const adapter = createLangChainCypherAdapter(schema, {
  defaultLimit: 25,
  defaultMaxHops: 5,
  parserMode: "lint"
});

const result = await adapter.compileQuery(cypherQueryIr);

if (!result.canExecute) {
  // Send result.diagnostics back to the model for repair.
}
```

For legacy text2cypher chains:

```ts
const result = await adapter.correctRawCypher(rawCypher);
```

That path is intentionally narrow: it quotes known identifiers and runs parser validation. Direction repair, bounded paths, and limit insertion should move to structured IR through `compileQuery`.
