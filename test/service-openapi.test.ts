import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import { buildCompilerServiceManifest } from "../src/service-manifest.js";
import { buildCompilerServiceOpenApi, type CompilerServiceOpenApi } from "../src/service-openapi.js";
import { CYPHER_COMPILER_TOOLS } from "../src/tools.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("compiler service OpenAPI contract", () => {
  it("describes service routes and tool request schemas", () => {
    const spec = buildCompilerServiceOpenApi(CYPHER_COMPILER_TOOLS, {
      authRequired: true,
      auditEnabled: true,
      maxBodyBytes: 2_000,
      serverUrl: "https://compiler.example.test"
    });
    const manifest = buildCompilerServiceManifest({
      authRequired: true,
      auditEnabled: true,
      maxBodyBytes: 2_000
    });

    assert.equal(spec.version, "cypher-llm-service-openapi/v1");
    assert.equal(spec.openapi, "3.1.0");
    assert.equal(spec.servers[0]?.url, "https://compiler.example.test");
    assert.deepEqual(spec.security, [{ bearerAuth: [] }]);
    assert.deepEqual(spec.paths["/v1/openapi"]?.get?.security, []);
    assert.equal(spec.paths["/v1/render"]?.post?.operationId, "cypher_render");
    const renderRequestSchema = spec.paths["/v1/render"]?.post?.requestBody?.content["application/json"].schema as {
      required?: string[];
    };
    assert.equal(renderRequestSchema.required?.includes("schema"), true);
    assert.equal(spec.paths["/v1/tools/{toolName}"]?.post?.operationId, "cypher_tool_by_name");
    assert.equal(spec.summary.maxBodyBytes, 2_000);
    assert.equal(spec.summary.authenticatedRoutes > 0, true);

    for (const route of manifest.routes) {
      const item = spec.paths[route.path];
      const method = route.method.toLowerCase();
      assert.ok(item?.[method], `${route.method} ${route.path} missing from OpenAPI spec`);
    }
  });

  it("keeps checked-in service OpenAPI JSON aligned with runtime defaults and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const serviceOpenApiSchema = readJson("schemas/service-openapi.schema.json");
    const checkedIn = readJson<CompilerServiceOpenApi>("examples/service/service-openapi.json");
    ajv.addSchema(serviceOpenApiSchema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/service-openapi/v1.json");

    assert.ok(validate, "missing service OpenAPI schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(checkedIn, buildCompilerServiceOpenApi(CYPHER_COMPILER_TOOLS));
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
