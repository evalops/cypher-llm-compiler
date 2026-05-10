# Agent Integrations

The compiler exposes the same five operations across OpenAI tool schemas, MCP, LangChain-shaped adapters, and the CLI:

- `cypher_render`: repair IR, validate, and return a `SafeExecutionPlan`.
- `cypher_validate`: return stable compiler diagnostics for IR.
- `cypher_repair`: repair structured IR or narrow legacy raw Cypher failures.
- `cypher_parse_check`: run Neo4j language-support parser validation.
- `cypher_eval`: score model attempts against an eval dataset.

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

The exported tool schemas intentionally ask for `CypherQuery` IR instead of raw Cypher wherever possible. Raw Cypher remains available for migration through `cypher_repair` and `cypher_parse_check`.

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
