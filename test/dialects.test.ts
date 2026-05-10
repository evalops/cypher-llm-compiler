import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import { dialectProfiles, getDialectProfile, listDialectProfiles, type DialectProfile } from "../src/dialects.js";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";
import { renderQueryForDialect } from "../src/render.js";
import { validateQuery } from "../src/validate.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("dialect profiles", () => {
  it("exposes stable runtime helpers", () => {
    assert.equal(getDialectProfile("neo4j-cypher-25").status, "stable");
    assert.equal(getDialectProfile("opencypher-9").features.letClause, false);
    assert.equal(getDialectProfile("gql").rendering.relationshipRangeStyle, "gql-quantifier");
    assert.deepEqual(
      listDialectProfiles().map((profile) => profile.id),
      ["neo4j-cypher-25", "opencypher-9", "gql"]
    );
  });

  it("keeps checked-in profile artifacts aligned with runtime profiles", () => {
    const fromDisk = ["neo4j-cypher-25", "opencypher-9", "gql"].map((id) =>
      readJson<DialectProfile>(`profiles/${id}.json`)
    );

    assert.deepEqual(fromDisk, dialectProfiles);
  });

  it("validates checked-in profiles against the dialect JSON Schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = readJson("schemas/dialect-profile.schema.json");
    ajv.addSchema(schema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/dialect-profile/v1.json");
    assert.ok(validate, "missing dialect profile schema");

    for (const profile of dialectProfiles) {
      assert.equal(validate(profile), true, JSON.stringify(validate.errors, null, 2));
    }
  });

  it("enforces dialect feature flags and exposes dialect rendering", () => {
    const openCypherSchema: CypherSchemaContract = {
      version: "cypher-llm-schema/v1",
      dialect: "opencypher-9",
      nodes: [{ name: "Tool" }],
      relationships: []
    };
    const openCypherQuery: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        { kind: "let", bindings: [{ alias: "x", expression: { kind: "literal", value: 1 } }] },
        {
          kind: "match",
          patterns: [{ mode: "trail", shortest: "any", segments: [{ variable: "tool", labels: ["Tool"] }] }]
        },
        { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 1 } }
      ]
    };
    const gqlSchema: CypherSchemaContract = {
      version: "cypher-llm-schema/v1",
      dialect: "gql",
      nodes: [{ name: "Tool" }, { name: "Hash" }],
      relationships: [{ type: "HAS_HASH", from: "Tool", to: "Hash" }]
    };
    const gqlQuery: CypherQuery = {
      version: "cypher-llm-ir/v1",
      clauses: [
        {
          kind: "match",
          patterns: [
            {
              segments: [
                { variable: "tool", labels: ["Tool"] },
                { rel: { types: ["HAS_HASH"], direction: "out", minHops: 1, maxHops: 3 }, node: { variable: "hash", labels: ["Hash"] } }
              ]
            }
          ]
        },
        { kind: "return", items: [{ expression: { kind: "var", name: "hash" } }], limit: { kind: "literal", value: 1 } }
      ]
    };

    assert.ok(validateQuery(openCypherQuery, openCypherSchema).diagnostics.some((item) => item.code === "dialect-unsupported-feature"));
    assert.ok(validateQuery(gqlQuery, gqlSchema).diagnostics.some((item) => item.code === "dialect-rendering-limitation"));
    assert.equal(renderQueryForDialect(gqlQuery, "gql").includes("MATCH"), true);
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
