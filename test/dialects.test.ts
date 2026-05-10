import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import { dialectProfiles, getDialectProfile, listDialectProfiles, type DialectProfile } from "../src/dialects.js";

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
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
