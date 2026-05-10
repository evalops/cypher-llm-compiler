import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildCompilerServiceManifest } from "../src/service-manifest.js";
import { buildEmptyCompilerServiceMetricsReport } from "../src/service-metrics.js";

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
      manifest.routes.some((route) => route.path === "/v1/lossless-conformance" && route.operation === "cypher_lossless_conformance")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/agent-guide" && route.operation === "agent_guide" && route.method === "GET")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/agent-guide" && route.operation === "cypher_agent_guide" && route.method === "POST")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/diagnostic-catalog" && route.operation === "diagnostic_catalog" && route.method === "GET")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/diagnostic-catalog" && route.operation === "cypher_diagnostic_catalog" && route.method === "POST")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/compatibility" && route.operation === "compatibility_catalog" && route.method === "GET")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/compatibility" && route.operation === "cypher_compatibility_catalog" && route.method === "POST")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/compatibility-diff" && route.operation === "cypher_compatibility_diff" && route.method === "POST")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/contract-conformance" && route.operation === "contract_conformance" && route.method === "GET")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/contract-conformance" && route.operation === "cypher_contract_conformance" && route.method === "POST")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/policy-profiles" && route.operation === "cypher_policy_profiles")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/metrics" && route.operation === "service_metrics" && route.method === "GET")
    );
    assert.ok(
      manifest.routes.some((route) => route.path === "/v1/retry-eval" && route.operation === "cypher_retry_eval")
    );
    assert.equal(manifest.dataBoundary.storesPayloads, false);
    assert.equal(manifest.dataBoundary.returnsDatabaseRows, false);
  });

  it("keeps checked-in service manifest JSON aligned with runtime defaults", () => {
    const expected = JSON.parse(readFileSync(path.join(process.cwd(), "examples/service/service-manifest.json"), "utf8")) as unknown;

    assert.deepEqual(buildCompilerServiceManifest(), expected);
  });

  it("keeps checked-in service metrics JSON aligned with the empty contract example", () => {
    const expected = JSON.parse(readFileSync(path.join(process.cwd(), "examples/service/service-metrics.json"), "utf8")) as unknown;

    assert.deepEqual(buildEmptyCompilerServiceMetricsReport(), expected);
  });
});
