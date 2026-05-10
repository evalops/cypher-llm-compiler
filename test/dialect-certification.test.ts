import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import {
  certifyDialectProfiles,
  renderDialectCertificationMarkdown,
  type DialectCertificationReport
} from "../src/dialect-certification.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("dialect certification", () => {
  it("certifies every profile with explicit pass, warning, or failure status", () => {
    const report = certifyDialectProfiles();

    assert.equal(report.version, "cypher-llm-dialect-certification/v1");
    assert.equal(report.summary.profiles, 3);
    assert.equal(report.summary.failedChecks, 0);
    assert.equal(report.summary.warningChecks, 1);
    assert.equal(report.profiles.find((profile) => profile.profileId === "neo4j-cypher-25")?.status, "passed");
    assert.equal(report.profiles.find((profile) => profile.profileId === "opencypher-9")?.status, "passed");
    assert.equal(report.profiles.find((profile) => profile.profileId === "gql")?.status, "warning");
  });

  it("renders a markdown certification view", () => {
    const markdown = renderDialectCertificationMarkdown();

    assert.ok(markdown.includes("# Dialect Certification"));
    assert.ok(markdown.includes("Neo4j Cypher 25"));
    assert.ok(markdown.includes("renderer-relationship-range-style"));
  });

  it("keeps checked-in certification JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = readJson("schemas/dialect-certification.schema.json");
    const checkedIn = readJson<DialectCertificationReport>("examples/certification/dialect-certification.json");
    ajv.addSchema(schema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/dialect-certification/v1.json");

    assert.ok(validate, "missing dialect certification schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(checkedIn, certifyDialectProfiles());
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
