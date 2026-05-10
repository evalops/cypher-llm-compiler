import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import {
  buildDiagnosticCatalog,
  diagnosticCatalogIntegrityReport,
  renderDiagnosticCatalogMarkdown,
  type DiagnosticCatalog
} from "../src/diagnostic-catalog.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("diagnostic catalog", () => {
  it("publishes stable codes with model-facing actions", () => {
    const catalog = buildDiagnosticCatalog();
    const integrity = diagnosticCatalogIntegrityReport(catalog);
    const byCode = new Map(catalog.entries.map((entry) => [entry.code, entry]));

    assert.equal(catalog.version, "cypher-llm-diagnostic-catalog/v1");
    assert.equal(integrity.ok, true);
    assert.ok(catalog.entries.length > 60);
    assert.equal(byCode.get("missing-limit")?.preferredAction, "apply-deterministic-repair");
    assert.equal(byCode.get("unknown-label")?.preferredAction, "ask-for-schema");
    assert.equal(byCode.get("policy-write-risk")?.preferredAction, "request-approval");
    assert.equal(byCode.get("cypher-parser-error")?.source, "parser-validation");
    assert.equal(byCode.get("lossless-unmatched-delimiter")?.source, "lossless-parser");
    assert.equal(byCode.get("profile-metadata-incomplete")?.source, "dialect-certification");
    assert.equal(byCode.get("missing-attempt")?.source, "eval-runner");
    assert.equal(byCode.get("neo4j-*")?.match, "prefix");
    assert.equal(byCode.get("dataset-redaction-*")?.match, "prefix");
  });

  it("renders a markdown diagnostic catalog", () => {
    const markdown = renderDiagnosticCatalogMarkdown();

    assert.ok(markdown.includes("# Diagnostic Catalog"));
    assert.ok(markdown.includes("missing-limit"));
    assert.ok(markdown.includes("policy-write-risk"));
  });

  it("keeps checked-in diagnostic catalog JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = readJson("schemas/diagnostic-catalog.schema.json");
    const checkedIn = readJson<DiagnosticCatalog>("examples/diagnostics/diagnostic-catalog.json");
    ajv.addSchema(schema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/diagnostic-catalog/v1.json");

    assert.ok(validate, "missing diagnostic catalog schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(checkedIn, buildDiagnosticCatalog());
  });

  it("covers static diagnostic code literals in source", () => {
    const catalog = buildDiagnosticCatalog();
    const exactCodes = new Set(catalog.entries.filter((entry) => entry.match === "exact").map((entry) => entry.code));
    const prefixCodes = catalog.entries.filter((entry) => entry.match === "prefix").map((entry) => entry.code.replace(/\*$/, ""));
    const sourceCodes = staticSourceCodes();
    const missing = [...sourceCodes].filter((code) => !exactCodes.has(code) && !prefixCodes.some((prefix) => code.startsWith(prefix)));

    assert.deepEqual(missing.sort(), []);
    assert.ok(exactCodes.has("policy-unfiltered-label-scan"));
    assert.ok(exactCodes.has("policy-unfiltered-node-scan"));
    assert.ok(exactCodes.has("procedure-argument-mismatch"));
    assert.ok(exactCodes.has("lossless-unterminated-token"));
    assert.ok(exactCodes.has("unescaped-schema-identifier"));
    assert.ok(exactCodes.has("empty-attempt"));
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}

function staticSourceCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of tsFiles(path.join(process.cwd(), "src"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bcode:\s*"([^"]+)"/g)) {
      const code = match[1];
      if (code !== undefined) {
        codes.add(code);
      }
    }
    for (const match of source.matchAll(/tokenDiagnostic\(\s*"([^"]+)"/g)) {
      const code = match[1];
      if (code !== undefined) {
        codes.add(code);
      }
    }
    for (const match of source.matchAll(/diagnostics:[^\n]*\[\s*"([^"]+)"/g)) {
      const code = match[1];
      if (code !== undefined) {
        codes.add(code);
      }
    }
  }
  return codes;
}

function tsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...tsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}
