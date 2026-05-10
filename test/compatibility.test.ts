import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import {
  buildCompatibilityCatalog,
  compatibilityIntegrityReport,
  renderCompatibilityCatalogMarkdown,
  type CompatibilityCatalog
} from "../src/compatibility.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("compatibility catalog", () => {
  it("defines stable levels, public contracts, and release gates", () => {
    const catalog = buildCompatibilityCatalog();
    const integrity = compatibilityIntegrityReport(catalog);
    const packageJson = readJson<{ name: string; version: string }>("package.json");

    assert.equal(catalog.version, "cypher-llm-compatibility-catalog/v1");
    assert.equal(catalog.packageName, packageJson.name);
    assert.equal(catalog.packageVersion, packageJson.version);
    assert.ok(catalog.levels.some((level) => level.level === "stable"));
    assert.ok(catalog.contracts.some((contract) => contract.version === "cypher-llm-ir/v1" && contract.level === "stable"));
    assert.ok(catalog.contracts.some((contract) => contract.id === "diagnostic-shape" && contract.category === "diagnostic"));
    assert.ok(catalog.contracts.some((contract) => contract.id === "service-manifest" && contract.category === "service"));
    assert.ok(catalog.contracts.some((contract) => contract.id === "compatibility-catalog" && contract.schemaPath));
    assert.ok(catalog.releaseGates.some((gate) => gate.command === "npm test"));
    assert.equal(integrity.ok, true);
  });

  it("renders a markdown compatibility view", () => {
    const markdown = renderCompatibilityCatalogMarkdown();

    assert.ok(markdown.includes("# Compatibility Catalog"));
    assert.ok(markdown.includes("cypher-llm-ir/v1"));
    assert.ok(markdown.includes("npm test"));
  });

  it("keeps checked-in compatibility catalog JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = readJson("schemas/compatibility-catalog.schema.json");
    const checkedIn = readJson<CompatibilityCatalog>("examples/governance/compatibility-catalog.json");
    ajv.addSchema(schema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/compatibility-catalog/v1.json");

    assert.ok(validate, "missing compatibility schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(checkedIn, buildCompatibilityCatalog());
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
