import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { certifyDialectProfiles } from "./dialect-certification.js";
import { CYPHER_COMPILER_TOOLS, executeCypherCompilerTool, type CypherCompilerToolName } from "./tools.js";
import { getYearsRoadmap } from "./years-roadmap.js";

export interface CompilerHttpServerOptions {
  maxBodyBytes?: number;
}

export interface CompilerHttpHealth {
  version: "cypher-llm-compiler-http/v1";
  ok: true;
  tools: number;
}

const DEFAULT_MAX_BODY_BYTES = 1_000_000;

const TOOL_ROUTES: Record<string, CypherCompilerToolName> = {
  "/v1/render": "cypher_render",
  "/v1/validate": "cypher_validate",
  "/v1/repair": "cypher_repair",
  "/v1/parse-lossless": "cypher_parse_lossless",
  "/v1/parse-check": "cypher_parse_check",
  "/v1/policy": "cypher_policy_check",
  "/v1/lsp-diagnostics": "cypher_lsp_diagnostics",
  "/v1/prove": "cypher_prove",
  "/v1/eval": "cypher_eval",
  "/v1/scorecard": "cypher_scorecard"
};

export function createCompilerHttpServer(options: CompilerHttpServerOptions = {}): Server {
  return createServer((request, response) => {
    handleCompilerHttpRequest(request, response, options).catch((error) => {
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
  if (request.method === "GET" && url.pathname === "/healthz") {
    const health: CompilerHttpHealth = {
      version: "cypher-llm-compiler-http/v1",
      ok: true,
      tools: CYPHER_COMPILER_TOOLS.length
    };
    writeJson(response, 200, health);
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/tools") {
    writeJson(response, 200, { tools: CYPHER_COMPILER_TOOLS });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/roadmap") {
    writeJson(response, 200, getYearsRoadmap());
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/dialect-certification") {
    writeJson(response, 200, certifyDialectProfiles());
    return;
  }

  const toolName = toolNameForPath(url.pathname);
  if (!toolName) {
    writeJson(response, 404, { error: { code: "not-found", message: `Unknown route: ${url.pathname}` } });
    return;
  }

  if (request.method !== "POST") {
    writeJson(response, 405, { error: { code: "method-not-allowed", message: "Compiler tool routes require POST." } });
    return;
  }

  let input: unknown;
  try {
    input = await readJsonBody(request, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, message.includes("too large") ? 413 : 400, {
      error: { code: "invalid-json-body", message }
    });
    return;
  }

  try {
    writeJson(response, 200, await executeCypherCompilerTool(toolName, input));
  } catch (error) {
    writeJson(response, 422, {
      error: {
        code: "compiler-tool-error",
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

function toolNameForPath(pathname: string): CypherCompilerToolName | undefined {
  if (TOOL_ROUTES[pathname]) {
    return TOOL_ROUTES[pathname];
  }
  const match = pathname.match(/^\/v1\/tools\/([a-z_]+)$/);
  const candidate = match?.[1];
  return CYPHER_COMPILER_TOOLS.some((tool) => tool.name === candidate) ? (candidate as CypherCompilerToolName) : undefined;
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
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
  return text.length === 0 ? {} : JSON.parse(text);
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}
