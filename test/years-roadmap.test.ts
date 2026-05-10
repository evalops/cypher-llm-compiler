import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import {
  getYearsRoadmap,
  renderYearsRoadmapMarkdown,
  roadmapIntegrityReport,
  type YearsRoadmap
} from "../src/years-roadmap.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("years-scale roadmap", () => {
  it("keeps the public issue-backed roadmap internally consistent", () => {
    const roadmap = getYearsRoadmap();
    const report = roadmapIntegrityReport(roadmap);

    assert.equal(report.ok, true);
    assert.equal(report.workstreams, 8);
    assert.equal(report.capabilities >= 10, true);
    assert.deepEqual(report.diagnostics, []);
    assert.deepEqual(
      roadmap.workstreams.map((workstream) => workstream.issue.number),
      [10, 11, 12, 13, 14, 15, 16, 17]
    );
  });

  it("renders a markdown view for humans", () => {
    const markdown = renderYearsRoadmapMarkdown();

    assert.ok(markdown.includes("# Years-Scale Roadmap"));
    assert.ok(markdown.includes("Lossless Cypher Parser And AST Round Trip"));
    assert.ok(markdown.includes("https://github.com/evalops/cypher-llm-compiler/issues/17"));
  });

  it("keeps checked-in roadmap JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = readJson("schemas/years-roadmap.schema.json");
    const checkedIn = readJson<YearsRoadmap>("examples/roadmap/cypher-llm-years-roadmap.json");
    ajv.addSchema(schema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/years-roadmap/v1.json");

    assert.ok(validate, "missing years roadmap schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(checkedIn, getYearsRoadmap());
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
