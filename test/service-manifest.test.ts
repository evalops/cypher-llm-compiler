import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildCompilerServiceManifest } from "../src/service-manifest.js";

describe("compiler service manifest", () => {
  it("describes runtime auth, audit, limits, and routes", () => {
    const manifest = buildCompilerServiceManifest({
      authRequired: true,
      auditEnabled: true,
      maxBodyBytes: 2_000
    });

    assert.equal(manifest.version, "cypher-llm-service-manifest/v1");
    assert.equal(manifest.auth.required, true);
    assert.equal(manifest.audit.enabled, true);
    assert.equal(manifest.limits.maxBodyBytes, 2_000);
    assert.ok(manifest.routes.some((route) => route.path === "/healthz" && route.authRequired === false));
    assert.ok(manifest.routes.some((route) => route.path === "/v1/render" && route.operation === "cypher_render" && route.authRequired === true));
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/agent-feedback" && route.operation === "cypher_agent_feedback")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/policy-profiles" && route.operation === "cypher_policy_profiles")
    );
    assert.equal(manifest.dataBoundary.storesPayloads, false);
    assert.equal(manifest.dataBoundary.returnsDatabaseRows, false);
  });

  it("keeps checked-in service manifest JSON aligned with runtime defaults", () => {
    const expected = JSON.parse(readFileSync(path.join(process.cwd(), "examples/service/service-manifest.json"), "utf8")) as unknown;

    assert.deepEqual(buildCompilerServiceManifest(), expected);
  });
});
