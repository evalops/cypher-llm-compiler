# Raw Text2Cypher to Structured IR Migration

This example shows the intended adoption path for a chain that currently asks a model to return raw Cypher and then tries to patch it with string rules.

## Legacy Output

```cypher
MATCH (tool:Tool)<-[:has MD5 hash*1..]-(hash:Hash) RETURN hash
```

The common failures are visible in one string:

- The relationship type needs escaping.
- The relationship direction is backwards for the schema.
- The variable-length path is unbounded.
- The query has no explicit `LIMIT`.

`repairRawCypher` deliberately does not attempt broad regex rewrites for all of this. It can help migration, but it cannot safely infer the full program.

## Structured IR Output

Ask the model for this JSON shape instead:

```json
{
  "version": "cypher-llm-ir/v1",
  "profile": "llm-safe-readonly",
  "clauses": [
    {
      "kind": "match",
      "patterns": [
        {
          "segments": [
            { "variable": "tool", "labels": ["tool"] },
            {
              "rel": {
                "types": ["md5"],
                "direction": "in",
                "minHops": 1,
                "maxHops": null
              },
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
}
```

Then compile it:

```ts
import { createLangChainCypherAdapter } from "@evalops/cypher-llm-compiler";

const adapter = createLangChainCypherAdapter(schema, {
  defaultLimit: 25,
  defaultMaxHops: 3,
  parserMode: "lint"
});

const result = await adapter.compileQuery(query);
```

The compiler repairs aliases, direction, bounded traversal, and the missing limit before parser validation:

```cypher
MATCH (tool:`Tool`)-[:`has MD5 hash`*1..3]->(hash:`Hash`)
RETURN hash
LIMIT 25
```

The important change is not prettier text. The model now receives stable diagnostics and JSON-pointer paths when it gets the program wrong, so retry prompts can target the exact broken field instead of asking for another free-form query.
