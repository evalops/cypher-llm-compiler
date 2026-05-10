import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import type { CypherQuery, CypherSchemaContract } from "../src/ir.js";
import { buildLspDiagnostics, type LspDiagnosticReport } from "../src/lsp.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("LSP diagnostics", () => {
  it("turns compiler diagnostics and repairs into LSP diagnostics and code actions", () => {
    const report = buildLspDiagnostics(
      {
        schema: readJson<CypherSchemaContract>("examples/tool-hash.schema.json"),
        query: readJson<CypherQuery>("examples/tool-hash.query.json")
      },
      { uri: "file:///query.json" }
    );
    const diagnosticCodes = report.diagnostics.map((diagnostic) => diagnostic.code);
    const actionTitles = report.codeActions.map((action) => action.title);

    assert.equal(report.version, "cypher-llm-lsp-diagnostics/v1");
    assert.equal(report.languageId, "cypher-ir");
    assert.ok(diagnosticCodes.includes("missing-limit"));
    assert.ok(diagnosticCodes.includes("policy-missing-limit"));
    assert.ok(actionTitles.includes("Add a bounded LIMIT"));
    assert.ok(actionTitles.some((title) => title.includes("fix-direction")));
  });

  it("supports raw Cypher migration diagnostics", () => {
    const report = buildLspDiagnostics({
      schema: readJson<CypherSchemaContract>("examples/tool-hash.schema.json"),
      rawCypher: "MATCH (tool:Tool)-[:has MD5 hash]->(hash:Hash) RETURN hash.value"
    });

    assert.equal(report.languageId, "cypher");
    assert.equal(report.renderedCypher, "MATCH (tool:Tool)-[:`has MD5 hash`]->(hash:Hash) RETURN hash.value");
    assert.ok(report.codeActions.some((action) => action.title.includes("quote-raw-identifier")));
  });

  it("keeps checked-in LSP JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = readJson("schemas/lsp-diagnostics.schema.json");
    const checkedIn = readJson<LspDiagnosticReport>("examples/lsp/tool-hash.lsp.json");
    ajv.addSchema(schema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/lsp-diagnostics/v1.json");

    assert.ok(validate, "missing LSP diagnostics schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(
      checkedIn,
      buildLspDiagnostics(
        {
          schema: readJson<CypherSchemaContract>("examples/tool-hash.schema.json"),
          query: readJson<CypherQuery>("examples/tool-hash.query.json")
        },
        { uri: "file:///examples/tool-hash.query.json" }
      )
    );
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
