#!/usr/bin/env node
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import process from "node:process";
import { CYPHER_COMPILER_TOOLS, executeCypherCompilerTool } from "./tools.js";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export async function handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
  if (!request.id && request.method.startsWith("notifications/")) {
    return undefined;
  }

  switch (request.method) {
    case "initialize": {
      const params = isRecord(request.params) ? request.params : {};
      const protocolVersion = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18";
      return result(request.id ?? null, {
        protocolVersion,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "@evalops/cypher-llm-compiler",
          version: "0.1.0"
        }
      });
    }
    case "ping":
      return result(request.id ?? null, {});
    case "tools/list":
      return result(request.id ?? null, {
        tools: CYPHER_COMPILER_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      });
    case "tools/call": {
      if (!isRecord(request.params)) {
        return error(request.id ?? null, -32602, "tools/call requires object params.");
      }
      const params = request.params;
      const name = params.name;
      if (typeof name !== "string") {
        return error(request.id ?? null, -32602, "tools/call requires params.name.");
      }
      try {
        const output = await executeCypherCompilerTool(name, params.arguments ?? {});
        return result(request.id ?? null, {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
        });
      } catch (toolError) {
        return result(request.id ?? null, {
          content: [
            {
              type: "text",
              text: toolError instanceof Error ? toolError.message : String(toolError)
            }
          ],
          isError: true
        });
      }
    }
    default:
      return error(request.id ?? null, -32601, `Method not found: ${request.method}`);
  }
}

export async function runMcpServer(
  input: Readable = process.stdin,
  output: Writable = process.stdout
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    let response: JsonRpcResponse | undefined;
    let request: JsonRpcRequest | undefined;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch (parseError) {
      response = error(null, -32700, "Parse error", parseError instanceof Error ? parseError.message : String(parseError));
    }
    if (request) {
      try {
        response = await handleMcpRequest(request);
      } catch (serverError) {
        response = error(
          request.id ?? null,
          -32603,
          "Internal error",
          serverError instanceof Error ? serverError.message : String(serverError)
        );
      }
    }
    if (response) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  }
}

function result(id: JsonRpcId, value: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: value
  };
}

function error(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMcpServer();
}
