import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import process from "node:process";
import { buildAgentGuide } from "./agent-guide.js";
import { buildCompatibilityCatalog } from "./compatibility.js";
import { buildContractConformanceReport } from "./contract-conformance.js";
import { buildDiagnosticCatalog } from "./diagnostic-catalog.js";
import { certifyDialectProfiles } from "./dialect-certification.js";
import { CYPHER_COMPILER_TOOLS, executeCypherCompilerTool, type CypherCompilerToolName } from "./tools.js";
import { getYearsRoadmap } from "./years-roadmap.js";
import {
  createCompilerServiceMetricsState,
  recordCompilerServiceRequest,
  recordCompilerServiceSignals,
  snapshotCompilerServiceMetrics,
  type CompilerServiceMetricsState
} from "./service-metrics.js";
import {
  buildCompilerServiceManifest,
  COMPILER_HTTP_TOOL_ROUTES,
  DEFAULT_MAX_BODY_BYTES,
  isPublicCompilerServiceRoute
} from "./service-manifest.js";

export interface CompilerHttpServerOptions {
  maxBodyBytes?: number;
  authToken?: string;
  requireAuth?: boolean;
  auditSink?: CompilerHttpAuditSink;
  now?: () => Date;
  requestIdFactory?: () => string;
  metricsState?: CompilerServiceMetricsState;
}

export interface CompilerHttpHealth {
  version: "cypher-llm-compiler-http/v1";
  ok: true;
  tools: number;
  authRequired: boolean;
}

export interface CompilerHttpAuditEvent {
  version: "cypher-llm-http-audit/v1";
  requestId: string;
  at: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  authenticated: boolean;
  authRequired: boolean;
  bodyBytes: number;
  tool?: CypherCompilerToolName;
  errorCode?: string;
}

export type CompilerHttpAuditSink = (event: CompilerHttpAuditEvent) => void | Promise<void>;

export function createCompilerHttpServer(options: CompilerHttpServerOptions = {}): Server {
  const metricsState = options.metricsState ?? createCompilerServiceMetricsState(options.now?.() ?? new Date());
  return createServer((request, response) => {
    handleCompilerHttpRequest(request, response, { ...options, metricsState }).catch((error) => {
      writeJson(response, 500, {
        error: {
          code: "internal-error",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    });
  });
}

export async function handleCompilerHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: CompilerHttpServerOptions = {}
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const auth = authSettings(options);
  const routeAuthRequired = auth.required && !isPublicCompilerServiceRoute(url.pathname);
  const authenticated = routeAuthRequired ? isAuthorized(request, auth.token) : false;
  const requestId = requestIdFor(request, options);
  const metricsState = options.metricsState ?? createCompilerServiceMetricsState(options.now?.() ?? new Date());
  const startedAt = Date.now();
  const finish = async (
    statusCode: number,
    value: unknown,
    audit: { tool?: CypherCompilerToolName; bodyBytes?: number; errorCode?: string } = {},
    headers: Record<string, string> = {},
    metricsValue?: unknown
  ) => {
    recordCompilerServiceRequest(metricsState, {
      method: request.method ?? "GET",
      path: url.pathname,
      statusCode,
      ...(audit.tool ? { tool: audit.tool } : {})
    });
    if (metricsValue !== undefined) {
      recordCompilerServiceSignals(metricsState, metricsValue, audit.tool);
    }
    writeJson(response, statusCode, value, { ...headers, "x-request-id": requestId });
    await emitAudit(options, {
      requestId,
      method: request.method ?? "GET",
      path: url.pathname,
      statusCode,
      durationMs: Date.now() - startedAt,
      authenticated,
      authRequired: routeAuthRequired,
      bodyBytes: audit.bodyBytes ?? 0,
      ...(audit.tool ? { tool: audit.tool } : {}),
      ...(audit.errorCode ? { errorCode: audit.errorCode } : {})
    });
  };

  if (request.method === "GET" && url.pathname === "/healthz") {
    const health: CompilerHttpHealth = {
      version: "cypher-llm-compiler-http/v1",
      ok: true,
      tools: CYPHER_COMPILER_TOOLS.length,
      authRequired: auth.required
    };
    await finish(200, health);
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/service-manifest") {
    await finish(
      200,
      buildCompilerServiceManifest({
        maxBodyBytes,
        authRequired: auth.required,
        auditEnabled: options.auditSink !== undefined
      })
    );
    return;
  }

  if (routeAuthRequired && !authenticated) {
    await finish(
      401,
      { error: { code: "unauthorized", message: "Missing or invalid bearer token." } },
      { errorCode: "unauthorized" },
      { "www-authenticate": "Bearer" }
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/tools") {
    await finish(200, { tools: CYPHER_COMPILER_TOOLS });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/metrics") {
    await finish(200, snapshotCompilerServiceMetrics(metricsState, options.now?.() ?? new Date()));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/roadmap") {
    await finish(200, getYearsRoadmap());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/dialect-certification") {
    const report = certifyDialectProfiles();
    await finish(200, report, {}, {}, report);
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/compatibility") {
    await finish(200, buildCompatibilityCatalog());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/contract-conformance") {
    await finish(200, buildContractConformanceReport());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/agent-guide") {
    await finish(200, buildAgentGuide());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/diagnostic-catalog") {
    await finish(200, buildDiagnosticCatalog());
    return;
  }

  const toolName = toolNameForPath(url.pathname);
  if (!toolName) {
    await finish(404, { error: { code: "not-found", message: `Unknown route: ${url.pathname}` } }, { errorCode: "not-found" });
    return;
  }

  if (request.method !== "POST") {
    await finish(
      405,
      { error: { code: "method-not-allowed", message: "Compiler tool routes require POST." } },
      { tool: toolName, errorCode: "method-not-allowed" }
    );
    return;
  }

  let input: unknown;
  let bodyBytes = 0;
  try {
    const body = await readJsonBody(request, maxBodyBytes);
    input = body.value;
    bodyBytes = body.bytes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish(
      message.includes("too large") ? 413 : 400,
      {
        error: { code: "invalid-json-body", message }
      },
      { tool: toolName, errorCode: "invalid-json-body" }
    );
    return;
  }

  try {
    const result = await executeCypherCompilerTool(toolName, input);
    await finish(200, result, { tool: toolName, bodyBytes }, {}, result);
  } catch (error) {
    await finish(
      422,
      {
        error: {
          code: "compiler-tool-error",
          message: error instanceof Error ? error.message : String(error)
        }
      },
      { tool: toolName, bodyBytes, errorCode: "compiler-tool-error" }
    );
  }
}

function authSettings(options: CompilerHttpServerOptions): { required: boolean; token?: string } {
  const token = options.authToken ?? process.env.CYPHER_LLM_HTTP_TOKEN;
  const hasToken = typeof token === "string" && token.length > 0;
  const required = options.requireAuth ?? hasToken;
  return {
    required,
    ...(hasToken ? { token } : {})
  };
}

function isAuthorized(request: IncomingMessage, token: string | undefined): boolean {
  return token !== undefined && request.headers.authorization === `Bearer ${token}`;
}

function requestIdFor(request: IncomingMessage, options: CompilerHttpServerOptions): string {
  const header = request.headers["x-request-id"];
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  return options.requestIdFactory?.() ?? randomUUID();
}

async function emitAudit(
  options: CompilerHttpServerOptions,
  event: Omit<CompilerHttpAuditEvent, "version" | "at">
): Promise<void> {
  if (!options.auditSink) {
    return;
  }
  try {
    await options.auditSink({
      version: "cypher-llm-http-audit/v1",
      at: (options.now?.() ?? new Date()).toISOString(),
      ...event
    });
  } catch {
    // Audit sinks should not make the compiler endpoint fail after the response is written.
  }
}

function toolNameForPath(pathname: string): CypherCompilerToolName | undefined {
  const toolRoutes: Record<string, CypherCompilerToolName> = COMPILER_HTTP_TOOL_ROUTES;
  if (toolRoutes[pathname]) {
    return toolRoutes[pathname];
  }
  const match = pathname.match(/^\/v1\/tools\/([a-z_]+)$/);
  const candidate = match?.[1];
  return CYPHER_COMPILER_TOOLS.some((tool) => tool.name === candidate) ? (candidate as CypherCompilerToolName) : undefined;
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<{ value: unknown; bytes: number }> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maxBodyBytes) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return {
    value: text.length === 0 ? {} : JSON.parse(text),
    bytes: received
  };
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown, headers: Record<string, string> = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}
