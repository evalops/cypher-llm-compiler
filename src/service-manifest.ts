import type { CypherCompilerToolName } from "./tools.js";

export const DEFAULT_MAX_BODY_BYTES = 1_000_000;

export const COMPILER_HTTP_TOOL_ROUTES = {
  "/v1/render": "cypher_render",
  "/v1/validate": "cypher_validate",
  "/v1/repair": "cypher_repair",
  "/v1/repair-plan": "cypher_repair_plan",
  "/v1/lossless-conformance": "cypher_lossless_conformance",
  "/v1/parse-lossless": "cypher_parse_lossless",
  "/v1/parse-check": "cypher_parse_check",
  "/v1/policy": "cypher_policy_check",
  "/v1/policy-eval": "cypher_policy_eval",
  "/v1/policy-profiles": "cypher_policy_profiles",
  "/v1/lsp-diagnostics": "cypher_lsp_diagnostics",
  "/v1/prove": "cypher_prove",
  "/v1/agent-feedback": "cypher_agent_feedback",
  "/v1/agent-guide": "cypher_agent_guide",
  "/v1/diagnostic-catalog": "cypher_diagnostic_catalog",
  "/v1/compatibility": "cypher_compatibility_catalog",
  "/v1/compatibility-diff": "cypher_compatibility_diff",
  "/v1/contract-conformance": "cypher_contract_conformance",
  "/v1/eval": "cypher_eval",
  "/v1/scorecard": "cypher_scorecard",
  "/v1/benchmark-gate": "cypher_benchmark_gate",
  "/v1/retry-eval": "cypher_retry_eval",
  "/v1/dataset-governance": "cypher_dataset_governance"
} as const satisfies Record<string, CypherCompilerToolName>;

export interface CompilerServiceManifestOptions {
  maxBodyBytes?: number;
  authRequired?: boolean;
  auditEnabled?: boolean;
}

export interface CompilerServiceRoute {
  method: "GET" | "POST";
  path: string;
  operation: string;
  authRequired: boolean;
}

export interface CompilerServiceManifest {
  version: "cypher-llm-service-manifest/v1";
  service: {
    id: "cypher-llm-compiler-http";
    contract: "cypher-llm-compiler-http/v1";
  };
  limits: {
    maxBodyBytes: number;
  };
  auth: {
    required: boolean;
    scheme: "Bearer";
    header: "authorization";
    envVar: "CYPHER_LLM_HTTP_TOKEN";
    publicRoutes: string[];
  };
  audit: {
    enabled: boolean;
    eventVersion: "cypher-llm-http-audit/v1";
    redaction: "request-response-payloads-omitted";
    fields: string[];
  };
  dataBoundary: {
    storesPayloads: false;
    returnsDatabaseRows: false;
    logsDatabaseCredentials: false;
  };
  routes: CompilerServiceRoute[];
}

const PUBLIC_ROUTES = ["/healthz", "/v1/service-manifest"] as const;

export function buildCompilerServiceManifest(options: CompilerServiceManifestOptions = {}): CompilerServiceManifest {
  const authRequired = options.authRequired ?? false;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  return {
    version: "cypher-llm-service-manifest/v1",
    service: {
      id: "cypher-llm-compiler-http",
      contract: "cypher-llm-compiler-http/v1"
    },
    limits: {
      maxBodyBytes
    },
    auth: {
      required: authRequired,
      scheme: "Bearer",
      header: "authorization",
      envVar: "CYPHER_LLM_HTTP_TOKEN",
      publicRoutes: [...PUBLIC_ROUTES]
    },
    audit: {
      enabled: options.auditEnabled ?? false,
      eventVersion: "cypher-llm-http-audit/v1",
      redaction: "request-response-payloads-omitted",
      fields: [
        "requestId",
        "at",
        "method",
        "path",
        "tool",
        "statusCode",
        "durationMs",
        "authenticated",
        "authRequired",
        "bodyBytes",
        "errorCode"
      ]
    },
    dataBoundary: {
      storesPayloads: false,
      returnsDatabaseRows: false,
      logsDatabaseCredentials: false
    },
    routes: [
      { method: "GET", path: "/healthz", operation: "health", authRequired: false },
      { method: "GET", path: "/v1/service-manifest", operation: "service_manifest", authRequired: false },
      { method: "GET", path: "/v1/tools", operation: "tool_metadata", authRequired },
      { method: "GET", path: "/v1/metrics", operation: "service_metrics", authRequired },
      { method: "GET", path: "/v1/roadmap", operation: "years_roadmap", authRequired },
      { method: "GET", path: "/v1/dialect-certification", operation: "dialect_certification", authRequired },
      { method: "GET", path: "/v1/agent-guide", operation: "agent_guide", authRequired },
      { method: "GET", path: "/v1/diagnostic-catalog", operation: "diagnostic_catalog", authRequired },
      { method: "GET", path: "/v1/compatibility", operation: "compatibility_catalog", authRequired },
      { method: "GET", path: "/v1/contract-conformance", operation: "contract_conformance", authRequired },
      ...Object.entries(COMPILER_HTTP_TOOL_ROUTES).map(
        ([path, operation]): CompilerServiceRoute => ({ method: "POST", path, operation, authRequired })
      )
    ]
  };
}

export function isPublicCompilerServiceRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => route === pathname);
}
