import type { CypherQuery, CypherSchemaContract } from "./ir.js";
import { renderQuery } from "./render.js";
import { repairQuery, repairRawCypher } from "./repair.js";
import { normalizeSchema } from "./schema.js";
import { validateQuery } from "./validate.js";

export interface LlmFailureCase {
  id: string;
  source: string;
  problem: string;
  schema: CypherSchemaContract;
  rawCypher?: string;
  query?: CypherQuery;
  expectedDiagnosticCodes?: string[];
  expectedRepairContains?: string;
}

export interface FailureCaseResult {
  id: string;
  passed: boolean;
  cypher?: string;
  diagnosticCodes: string[];
}

const toolHashSchema: CypherSchemaContract = {
  version: "cypher-llm-schema/v1",
  dialect: "neo4j-cypher-25",
  nodes: [
    { name: "Tool", aliases: ["tool"], properties: { name: { type: "STRING" }, score: { type: "INTEGER" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [{ type: "has MD5 hash", aliases: ["md5"], from: "Tool", to: "Hash" }],
  parameters: { toolName: { type: "STRING", required: true }, numericToolName: { type: "INTEGER" } },
  procedures: {
    "db.indexes": {
      yields: {
        name: "STRING",
        type: "STRING",
        labelsOrTypes: "LIST<STRING>"
      }
    },
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

const openCypherSchema: CypherSchemaContract = {
  ...toolHashSchema,
  dialect: "opencypher-9"
};

const gqlSchema: CypherSchemaContract = {
  ...toolHashSchema,
  dialect: "gql"
};

export const llmFailureCorpus: LlmFailureCase[] = [
  {
    id: "relationship-type-with-spaces",
    source: "langchain-style raw text generation",
    problem: "Relationship type with spaces is emitted without backticks.",
    schema: toolHashSchema,
    rawCypher: "MATCH (tool:Tool)-[:has MD5 hash]->(hash:Hash) RETURN hash.value",
    expectedRepairContains: "[:`has MD5 hash`]"
  },
  {
    id: "relationship-direction-guessed",
    source: "text2cypher-style natural-language direction guess",
    problem: "The model guessed the inverse relationship direction even though endpoint labels make the fix deterministic.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [
            {
              segments: [
                { variable: "tool", labels: ["Tool"] },
                { rel: { types: ["has MD5 hash"], direction: "in" }, node: { variable: "hash", labels: ["Hash"] } }
              ]
            }
          ]
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "hash" } }]
        }
      ]
    },
    expectedRepairContains: "-[:`has MD5 hash`]->"
  },
  {
    id: "with-drops-variable",
    source: "semantic scope drift",
    problem: "A variable is referenced after a WITH clause dropped it.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
        },
        {
          kind: "with",
          items: [{ expression: { kind: "literal", value: 1 }, alias: "one" }]
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "tool" } }],
          limit: { kind: "literal", value: 10 }
        }
      ]
    },
    expectedDiagnosticCodes: ["undefined-variable"]
  },
  {
    id: "sql-between",
    source: "SQL prior leakage",
    problem: "The model uses SQL BETWEEN syntax in raw Cypher.",
    schema: toolHashSchema,
    rawCypher: "MATCH (tool:Tool) WHERE tool.size BETWEEN 1 AND 5 RETURN tool",
    expectedDiagnosticCodes: ["sqlism-between"]
  },
  {
    id: "unbounded-variable-length-path",
    source: "over-broad graph traversal",
    problem: "The model emits an unbounded traversal that can explode at runtime.",
    schema: toolHashSchema,
    query: {
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
                  rel: { types: ["has MD5 hash"], direction: "out", minHops: 1, maxHops: null },
                  node: { variable: "hash", labels: ["Hash"] }
                }
              ]
            }
          ]
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "hash" } }],
          limit: { kind: "literal", value: 10 }
        }
      ]
    },
    expectedDiagnosticCodes: ["unbounded-variable-length-path"]
  },
  {
    id: "ambiguous-aggregation-expression",
    source: "semantic aggregation drift",
    problem: "The model combines an aggregate and a scalar variable reference in the same projection expression.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
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
              alias: "mixed"
            }
          ],
          limit: { kind: "literal", value: 10 }
        }
      ]
    },
    expectedDiagnosticCodes: ["ambiguous-aggregation-expression"]
  },
  {
    id: "aggregate-without-alias",
    source: "semantic aggregation drift",
    problem: "The model emits an aggregate projection without an alias for later repair loops to target.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
        },
        {
          kind: "return",
          items: [{ expression: { kind: "function", name: "count", arguments: [{ kind: "var", name: "tool" }] } }],
          limit: { kind: "literal", value: 10 }
        }
      ]
    },
    expectedDiagnosticCodes: ["aggregate-alias-required"]
  },
  {
    id: "aggregate-predicate-repeats-aggregate",
    source: "semantic aggregation drift",
    problem: "The model repeats an aggregate call in WITH WHERE instead of filtering on the aggregate alias.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }]
        },
        {
          kind: "with",
          items: [{ expression: { kind: "function", name: "count", arguments: [{ kind: "var", name: "tool" }] }, alias: "toolCount" }],
          where: {
            kind: "binary",
            op: ">",
            left: { kind: "function", name: "count", arguments: [{ kind: "var", name: "tool" }] },
            right: { kind: "literal", value: 1 }
          }
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "toolCount" } }],
          limit: { kind: "literal", value: 10 }
        }
      ]
    },
    expectedDiagnosticCodes: ["invalid-aggregation"]
  },
  {
    id: "procedure-yield-mismatch",
    source: "procedure metadata mismatch",
    problem: "The model asks a procedure to YIELD a variable that the schema metadata says it does not produce.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
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
    },
    expectedDiagnosticCodes: ["unknown-procedure-yield"]
  },
  {
    id: "subquery-import-undefined",
    source: "subquery scope drift",
    problem: "The model imports a variable into CALL {} before that variable exists in the outer scope.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "call",
          import: ["tool"],
          subquery: {
            version: "cypher-llm-ir/v1",
            clauses: [
              {
                kind: "return",
                items: [{ expression: { kind: "var", name: "tool" } }]
              }
            ]
          }
        },
        {
          kind: "return",
          items: [{ expression: { kind: "var", name: "tool" } }],
          limit: { kind: "literal", value: 10 }
        }
      ]
    },
    expectedDiagnosticCodes: ["subquery-import-undefined"]
  },
  {
    id: "text2cypher-property-type-mismatch",
    source: "text2cypher typed property drift",
    problem: "The model fills an integer property with a string literal.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"], properties: { score: { kind: "literal", value: "high" } } }] }]
        },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 10 } }
      ]
    },
    expectedDiagnosticCodes: ["property-type-mismatch"]
  },
  {
    id: "text2cypher-parameter-type-mismatch",
    source: "text2cypher parameter binding drift",
    problem: "The model uses an integer parameter where the schema expects a string property value.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"], properties: { name: { kind: "param", name: "numericToolName" } } }] }]
        },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 10 } }
      ]
    },
    expectedDiagnosticCodes: ["parameter-type-mismatch"]
  },
  {
    id: "text2cypher-comparison-type-mismatch",
    source: "text2cypher predicate drift",
    problem: "The model compares a string property to an integer literal.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [{ segments: [{ variable: "tool", labels: ["Tool"] }] }],
          where: {
            kind: "binary",
            op: ">",
            left: { kind: "prop", object: { kind: "var", name: "tool" }, key: "name" },
            right: { kind: "literal", value: 3 }
          }
        },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 10 } }
      ]
    },
    expectedDiagnosticCodes: ["comparison-type-mismatch"]
  },
  {
    id: "opencypher-function-argument-mismatch",
    source: "openCypher TCK function signature fixture",
    problem: "The model passes the wrong type to a string function.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "return",
          items: [{ expression: { kind: "function", name: "length", arguments: [{ kind: "literal", value: 123 }] }, alias: "badLength" }],
          limit: { kind: "literal", value: 10 }
        }
      ]
    },
    expectedDiagnosticCodes: ["function-argument-mismatch"]
  },
  {
    id: "procedure-argument-mismatch",
    source: "Neo4j procedure metadata fixture",
    problem: "The model calls a procedure with an argument type that does not match schema metadata.",
    schema: toolHashSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        { kind: "call", procedure: "db.awaitIndex", arguments: [{ kind: "literal", value: 123 }], yield: [{ expression: { kind: "var", name: "done" } }] },
        { kind: "return", items: [{ expression: { kind: "var", name: "done" } }], limit: { kind: "literal", value: 10 } }
      ]
    },
    expectedDiagnosticCodes: ["procedure-argument-mismatch"]
  },
  {
    id: "opencypher-dialect-unsupported-feature",
    source: "openCypher TCK dialect fixture",
    problem: "The model uses Cypher 25 path modes while targeting openCypher 9.",
    schema: openCypherSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        { kind: "match", patterns: [{ mode: "trail", shortest: "any", segments: [{ variable: "tool", labels: ["Tool"] }] }] },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 10 } }
      ]
    },
    expectedDiagnosticCodes: ["dialect-unsupported-feature"]
  },
  {
    id: "gql-rendering-limitation",
    source: "GQL profile compatibility fixture",
    problem: "The model requests a variable-length relationship under the GQL profile before GQL quantifier rendering exists.",
    schema: gqlSchema,
    query: {
      version: "cypher-llm-ir/v1",
      profile: "llm-safe-readonly",
      clauses: [
        {
          kind: "match",
          patterns: [
            {
              segments: [
                { variable: "tool", labels: ["Tool"] },
                { rel: { types: ["has MD5 hash"], direction: "out", minHops: 1, maxHops: 3 }, node: { variable: "hash", labels: ["Hash"] } }
              ]
            }
          ]
        },
        { kind: "return", items: [{ expression: { kind: "var", name: "hash" } }], limit: { kind: "literal", value: 10 } }
      ]
    },
    expectedDiagnosticCodes: ["dialect-rendering-limitation"]
  }
];

export function evaluateFailureCorpus(cases: LlmFailureCase[] = llmFailureCorpus): FailureCaseResult[] {
  return cases.map((testCase) => {
    const schema = normalizeSchema(testCase.schema);
    if (testCase.rawCypher) {
      const repair = repairRawCypher(testCase.rawCypher, schema);
      const diagnosticCodes = repair.diagnostics.map((item) => item.code);
      return {
        id: testCase.id,
        cypher: repair.cypher,
        diagnosticCodes,
        passed: expectedOutcomesMatch(testCase, repair.cypher, diagnosticCodes)
      };
    }

    if (testCase.query) {
      const beforeRepair = validateQuery(testCase.query, schema);
      const repair = repairQuery(testCase.query, schema, { defaultLimit: 25, defaultMaxHops: 5 });
      const validation = validateQuery(repair.query, schema);
      const diagnosticCodes = uniqueCodes([
        ...beforeRepair.diagnostics.map((item) => item.code),
        ...repair.diagnostics.map((item) => item.code),
        ...validation.diagnostics.map((item) => item.code)
      ]);
      const cypher = renderQuery(repair.query);
      return {
        id: testCase.id,
        cypher,
        diagnosticCodes,
        passed: expectedOutcomesMatch(testCase, cypher, diagnosticCodes)
      };
    }

    return {
      id: testCase.id,
      diagnosticCodes: ["invalid-fixture"],
      passed: false
    };
  });
}

function expectedOutcomesMatch(testCase: LlmFailureCase, cypher: string, diagnosticCodes: string[]): boolean {
  if (testCase.expectedRepairContains && !cypher.includes(testCase.expectedRepairContains)) {
    return false;
  }
  for (const expectedCode of testCase.expectedDiagnosticCodes ?? []) {
    if (!diagnosticCodes.includes(expectedCode)) {
      return false;
    }
  }
  return true;
}

function uniqueCodes(codes: string[]): string[] {
  return [...new Set(codes)];
}
