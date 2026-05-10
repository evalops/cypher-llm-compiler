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
    { name: "Tool", aliases: ["tool"], properties: { name: { type: "STRING" } } },
    { name: "Hash", properties: { value: { type: "STRING" } } }
  ],
  relationships: [{ type: "has MD5 hash", aliases: ["md5"], from: "Tool", to: "Hash" }],
  parameters: { toolName: { type: "STRING", required: true } }
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
