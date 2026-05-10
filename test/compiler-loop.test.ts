import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";
import { evaluateFailureCorpus } from "../src/failure-corpus.js";
import { equivalentQueries } from "../src/normalize.js";
import { repairQuery, repairRawCypher } from "../src/repair.js";
import { renderQuery } from "../src/render.js";
import { createSafeExecutionPlan } from "../src/safety.js";
import { normalizeSchema } from "../src/schema.js";
import { validateQuery } from "../src/validate.js";

const schema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  dialect: "neo4j-cypher-25",
  nodes: [
    { name: "Tool", aliases: ["tool"], properties: { name: { type: "STRING" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [{ type: "has MD5 hash", aliases: ["md5"], from: "Tool", to: "Hash" }],
  parameters: { toolName: { type: "STRING", required: true } }
};

describe("validation and repair", () => {
  it("reports aggregate placement mistakes with stable diagnostics", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }],
          where: {
            kind: "binary",
            op: ">",
            left: { kind: "function", name: "count", arguments: [{ kind: "var", name: "tool" }] },
            right: { kind: "literal", value: 1 }
          }
        },
        {
          kind: "return",
          items: [
            {
              expression: {
                kind: "binary",
                op: "+",
                left: { kind: "prop", object: { kind: "var", name: "tool" }, key: "name" },
                right: { kind: "function", name: "count", arguments: [{ kind: "var", name: "tool" }] }
              },
              alias: "badMix"
            }
          ],
          limit: { kind: "literal", value: 10 }
        }
      ]
    };

    const result = validateQuery(query, normalizeSchema(schema));
    const codes = result.diagnostics.map((item) => item.code);

    assert.equal(result.ok, false);
    assert.ok(codes.includes("aggregate-in-match-where"));
    assert.ok(codes.includes("ambiguous-aggregation-expression"));
  });

  it("reports aggregate alias and aggregate predicate mistakes", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
        },
        {
          kind: "with",
          items: [{ expression: { kind: "function", name: "count", arguments: [{ kind: "var", name: "tool" }] } }],
          where: {
            kind: "binary",
            op: ">",
            left: { kind: "function", name: "count", arguments: [{ kind: "var", name: "tool" }] },
            right: { kind: "literal", value: 1 }
          }
        },
        {
          kind: "return",
          items: [{ expression: { kind: "literal", value: 1 }, alias: "one" }],
          limit: { kind: "literal", value: 1 }
        }
      ]
    };

    const result = validateQuery(query, normalizeSchema(schema));
    const codes = result.diagnostics.map((item) => item.code);

    assert.equal(result.ok, false);
    assert.ok(codes.includes("aggregate-alias-required"));
    assert.ok(codes.includes("invalid-aggregation"));
  });

  it("tracks variables imported and exported by CALL subqueries", () => {
    const valid: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
        },
        {
          kind: "call",
          import: ["tool"],
          subquery: {
            version: "cypher-llm-ir/v1",
            clauses: [
              {
                kind: "match",
                patterns: [
                  {
                    segments: [
                      { variable: "tool", labels: ["Tool"] },
                      { rel: { types: ["has MD5 hash"], direction: "out" }, node: { variable: "hash", labels: ["Hash"] } }
                    ]
                  }
                ]
              },
              {
                kind: "return",
                items: [{ expression: { kind: "var", name: "hash" } }]
              }
            ]
          }
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "hash" } }],
          limit: { kind: "literal", value: 10 }
        }
      ]
    };
    const invalid: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        {
          kind: "call",
          import: ["missing"],
          subquery: {
            version: "cypher-llm-ir/v1",
            clauses: [{ kind: "return", items: [{ expression: { kind: "var", name: "missing" } }] }]
          }
        }
      ]
    };

    assert.equal(validateQuery(valid, normalizeSchema(schema)).ok, true);
    assert.ok(validateQuery(invalid, normalizeSchema(schema)).diagnostics.some((item) => item.code === "subquery-import-undefined"));
  });

  it("validates procedure YIELD variables when procedure metadata is present", () => {
    const procSchema: CypherSchemaContract = {
      ...schema,
      procedures: {
        "db.indexes": {
          yields: { name: "STRING", type: "STRING" }
        }
      }
    };
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        {
          kind: "call",
          procedure: "db.indexes",
          yield: [{ expression: { kind: "var", name: "badYield" } }]
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "badYield" } }],
          limit: { kind: "literal", value: 10 }
        }
      ]
    };

    const result = validateQuery(query, normalizeSchema(procSchema));

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "unknown-procedure-yield"));
  });

  it("reports property, parameter, comparison, function, and procedure type mismatches", () => {
    const typedSchema: CypherSchemaContract = {
      ...schema,
      nodes: [{ name: "Tool", properties: { name: { type: "STRING" }, score: { type: "INTEGER" } } }],
      relationships: [],
      parameters: { toolName: { type: "INTEGER", required: true } },
      procedures: {
        "db.awaitIndex": {
          arguments: { name: "STRING" },
          yields: { done: "BOOLEAN" }
        }
      },
      functions: {
        "app.slug": {
          arguments: { value: "STRING" },
          returns: "STRING"
        }
      }
    };
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [
            {
              segments: [
                {
                  variable: "tool",
                  labels: ["Tool"],
                  properties: {
                    name: { kind: "param", name: "toolName" },
                    score: { kind: "literal", value: "high" }
                  }
                }
              ]
            }
          ],
          where: {
            kind: "binary",
            op: ">",
            left: { kind: "prop", object: { kind: "var", name: "tool" }, key: "name" },
            right: { kind: "literal", value: 7 }
          }
        },
        {
          kind: "call",
          procedure: "db.awaitIndex",
          arguments: [{ kind: "literal", value: 123 }],
          yield: [{ expression: { kind: "var", name: "done" } }]
        },
        {
          kind: "return",
          items: [
            { expression: { kind: "function", name: "length", arguments: [{ kind: "literal", value: 123 }] }, alias: "badLength" },
            { expression: { kind: "function", name: "app.slug", arguments: [{ kind: "literal", value: 123 }] }, alias: "badSlug" }
          ],
          limit: { kind: "literal", value: 10 }
        }
      ]
    };

    const result = validateQuery(query, normalizeSchema(typedSchema));
    const codes = result.diagnostics.map((item) => item.code);

    assert.equal(result.ok, false);
    assert.ok(codes.includes("parameter-type-mismatch"));
    assert.ok(codes.includes("property-type-mismatch"));
    assert.ok(codes.includes("comparison-type-mismatch"));
    assert.ok(codes.includes("function-argument-mismatch"));
    assert.ok(codes.includes("procedure-argument-mismatch"));
  });

  it("reports scope, limit, direction, and traversal diagnostics with stable codes", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [
            {
              segments: [
                { variable: "tool", labels: ["Tool"] },
                {
                  rel: { variable: "rel", types: ["has MD5 hash"], direction: "in", minHops: 1, maxHops: null },
                  node: { variable: "hash", labels: ["Hash"] }
                }
              ]
            }
          ]
        },
        {
          kind: "with",
          items: [{ expression: { kind: "var", name: "hash" }, alias: "keptHash" }]
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "tool" } }]
        }
      ]
    };

    const result = validateQuery(query, normalizeSchema(schema));
    const codes = result.diagnostics.map((item) => item.code);

    assert.equal(result.ok, false);
    assert.ok(codes.includes("relationship-direction-mismatch"));
    assert.ok(codes.includes("unbounded-variable-length-path"));
    assert.ok(codes.includes("undefined-variable"));
    assert.ok(codes.includes("missing-limit"));
  });

  it("applies deterministic IR repairs before rendering", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [
            {
              segments: [
                { variable: "tool", labels: ["tool"] },
                { rel: { types: ["md5"], direction: "in", minHops: 1, maxHops: null }, node: { variable: "hash", labels: ["Hash"] } }
              ]
            }
          ]
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "hash" } }]
        }
      ]
    };

    const repaired = repairQuery(query, schema, { defaultLimit: 25, defaultMaxHops: 3 });
    const cypher = renderQuery(repaired.query);

    assert.deepEqual(
      repaired.applied.map((item) => item.kind),
      ["canonicalize-identifier", "canonicalize-identifier", "fix-direction", "bound-path", "add-limit"]
    );
    assert.equal(cypher, "MATCH (tool:`Tool`)-[:`has MD5 hash`*1..3]->(hash:`Hash`)\nRETURN hash\nLIMIT 25");
  });

  it("keeps raw Cypher repair narrow but useful for existing chains", () => {
    const repaired = repairRawCypher("MATCH (tool:Tool)-[:has MD5 hash]->(hash:Hash) RETURN hash.value", schema);

    assert.equal(repaired.cypher, "MATCH (tool:Tool)-[:`has MD5 hash`]->(hash:Hash) RETURN hash.value");
    assert.deepEqual(
      repaired.applied.map((item) => item.kind),
      ["quote-raw-identifier"]
    );
  });
});

describe("normalization and safety", () => {
  it("compares query equivalence through canonical rendering", () => {
    const left: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [{ kind: "return", items: [{ expression: { kind: "literal", value: 1 }, alias: "one" }] }]
    };
    const right: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [{ kind: "return", items: [{ expression: { kind: "literal", value: 1 }, alias: "one" }] }]
    };

    assert.equal(equivalentQueries(left, right), true);
  });

  it("requires approval for writes and always includes an EXPLAIN preflight", () => {
    const query: CypherQuery = {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-write",
      clauses: [
        {
          kind: "create",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "tool" } }],
          limit: { kind: "literal", value: 1 }
        }
      ]
    };

    const plan = createSafeExecutionPlan(query, schema);

    assert.equal(plan.mode, "write-requires-approval");
    assert.equal(plan.requiresApproval, true);
    assert.equal(plan.canExecute, false);
    assert.ok(plan.preflightCypher.startsWith("EXPLAIN\nCREATE"));
    assert.ok(plan.diagnostics.some((item) => item.code === "execution-approval-required"));
  });
});

describe("failure corpus", () => {
  it("keeps known LLM failure fixtures runnable", () => {
    const results = evaluateFailureCorpus();

    assert.equal(results.length >= 5, true);
    assert.deepEqual(
      results.map((result) => [result.id, result.passed]),
      results.map((result) => [result.id, true])
    );
  });
});
