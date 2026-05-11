import {
  buildCompilerServiceManifest,
  type CompilerServiceManifestOptions,
  type CompilerServiceRoute
} from "./service-manifest.js";
import type { CypherCompilerToolDefinition, JsonSchema } from "./tools.js";

export interface CompilerServiceOpenApiOptions extends CompilerServiceManifestOptions {
  serverUrl?: string;
}

export interface CompilerServiceOpenApi {
  version: "cypher-llm-service-openapi/v1";
  generatedAt: string;
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: { url: string; description: string }[];
  security: { bearerAuth: never[] }[];
  summary: {
    routes: number;
    operations: number;
    getRoutes: number;
    postRoutes: number;
    toolRoutes: number;
    publicRoutes: number;
    authenticatedRoutes: number;
    maxBodyBytes: number;
  };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http";
        scheme: "bearer";
      };
    };
    schemas: {
      JsonObject: JsonSchema;
      ErrorResponse: JsonSchema;
    };
  };
}

export interface OpenApiOperation {
  operationId: string;
  tags: string[];
  summary: string;
  description: string;
  security?: never[];
  parameters?: JsonSchema[];
  requestBody?: {
    required: boolean;
    content: {
      "application/json": {
        schema: JsonSchema;
      };
    };
  };
  responses: Record<string, {
    description: string;
    content?: {
      "application/json": {
        schema: JsonSchema;
      };
    };
  }>;
}

const PACKAGE_VERSION = "0.1.0";
const GENERATED_AT = "2026-05-10";

export function buildCompilerServiceOpenApi(
  tools: readonly CypherCompilerToolDefinition[],
  options: CompilerServiceOpenApiOptions = {}
): CompilerServiceOpenApi {
  const manifest = buildCompilerServiceManifest(options);
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const paths: Record<string, Record<string, OpenApiOperation>> = {};

  for (const route of manifest.routes) {
    const method = route.method.toLowerCase();
    paths[route.path] = {
      ...(paths[route.path] ?? {}),
      [method]: operationForRoute(
        route,
        toolByName.get(route.operation as CypherCompilerToolDefinition["name"]),
        manifest.limits.maxBodyBytes
      )
    };
  }

  paths["/v1/tools/{toolName}"] = {
    post: dynamicToolOperation(tools, manifest.auth.required, manifest.limits.maxBodyBytes)
  };

  const operations = Object.values(paths).reduce((sum, item) => sum + Object.keys(item).length, 0);
  return {
    version: "cypher-llm-service-openapi/v1",
    generatedAt: GENERATED_AT,
    openapi: "3.1.0",
    info: {
      title: "Cypher LLM Compiler HTTP API",
      version: PACKAGE_VERSION,
      description:
        "Machine-readable HTTP contract for the Cypher LLM compiler service. Tool routes use the same schemas as the OpenAI and MCP tool definitions."
    },
    servers: [
      {
        url: options.serverUrl ?? "http://127.0.0.1:8787",
        description: "Local compiler service"
      }
    ],
    security: manifest.auth.required ? [{ bearerAuth: [] }] : [],
    summary: {
      routes: manifest.routes.length + 1,
      operations,
      getRoutes: manifest.routes.filter((route) => route.method === "GET").length,
      postRoutes: manifest.routes.filter((route) => route.method === "POST").length + 1,
      toolRoutes: manifest.routes.filter((route) => route.method === "POST" && route.operation.startsWith("cypher_")).length + 1,
      publicRoutes: manifest.routes.filter((route) => !route.authRequired).length + (manifest.auth.required ? 0 : 1),
      authenticatedRoutes: manifest.routes.filter((route) => route.authRequired).length + (manifest.auth.required ? 1 : 0),
      maxBodyBytes: manifest.limits.maxBodyBytes
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer"
        }
      },
      schemas: {
        JsonObject: {
          type: "object",
          additionalProperties: true
        },
        ErrorResponse: {
          type: "object",
          additionalProperties: false,
          required: ["error"],
          properties: {
            error: {
              type: "object",
              additionalProperties: false,
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" }
              }
            }
          }
        }
      }
    }
  };
}

function operationForRoute(
  route: CompilerServiceRoute,
  tool: CypherCompilerToolDefinition | undefined,
  maxBodyBytes: number
): OpenApiOperation {
  const operation: OpenApiOperation = {
    operationId: route.operation,
    tags: [tool ? "compiler-tools" : "service-discovery"],
    summary: summaryForRoute(route, tool),
    description: descriptionForRoute(route, tool, maxBodyBytes),
    responses: responsesForRoute(route)
  };
  if (!route.authRequired) {
    operation.security = [];
  }
  if (route.method === "POST") {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: tool?.inputSchema ?? { type: "object", additionalProperties: true }
        }
      }
    };
  }
  return operation;
}

function dynamicToolOperation(
  tools: readonly CypherCompilerToolDefinition[],
  authRequired: boolean,
  maxBodyBytes: number
): OpenApiOperation {
  const operation: OpenApiOperation = {
    operationId: "cypher_tool_by_name",
    tags: ["compiler-tools"],
    summary: "Call a compiler tool by name.",
    description: `Dynamic route for compiler tools. Request bodies must match the selected tool schema and stay under ${maxBodyBytes} bytes.`,
    parameters: [
      {
        name: "toolName",
        in: "path",
        required: true,
        schema: {
          type: "string",
          enum: tools.map((tool) => tool.name)
        }
      }
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: true
          }
        }
      }
    },
    responses: {
      ...jsonResponse("200", "Compiler tool output."),
      ...jsonResponse("400", "Invalid JSON request body."),
      ...jsonResponse("401", "Missing or invalid bearer token."),
      ...jsonResponse("413", "Request body exceeds the service limit."),
      ...jsonResponse("422", "Compiler tool validation or execution error.")
    }
  };
  if (!authRequired) {
    operation.security = [];
  }
  return operation;
}

function summaryForRoute(route: CompilerServiceRoute, tool: CypherCompilerToolDefinition | undefined): string {
  if (tool) {
    return tool.description;
  }
  switch (route.operation) {
    case "health":
      return "Return service liveness and tool count.";
    case "service_manifest":
      return "Return the compiler service manifest.";
    case "service_openapi":
      return "Return the compiler service OpenAPI contract.";
    case "tool_metadata":
      return "Return OpenAI/MCP-compatible compiler tool metadata.";
    case "service_metrics":
      return "Return runtime service metrics without payload data.";
    case "years_roadmap":
      return "Return the public years-scale compiler roadmap.";
    case "dialect_certification":
      return "Return dialect certification results.";
    case "agent_guide":
      return "Return the LLM-facing agent guide.";
    case "diagnostic_catalog":
      return "Return stable diagnostic-code metadata.";
    case "compatibility_catalog":
      return "Return the compatibility catalog.";
    case "contract_conformance":
      return "Return public contract conformance results.";
    default:
      return `Return ${route.operation}.`;
  }
}

function descriptionForRoute(
  route: CompilerServiceRoute,
  tool: CypherCompilerToolDefinition | undefined,
  maxBodyBytes: number
): string {
  if (tool) {
    return `${tool.description} Request bodies are JSON and must stay under ${maxBodyBytes} bytes.`;
  }
  return route.authRequired
    ? "This discovery route requires bearer authentication when service auth is enabled."
    : "This discovery route is public for liveness or client bootstrapping.";
}

function responsesForRoute(route: CompilerServiceRoute) {
  const responses = {
    ...jsonResponse("200", route.method === "GET" ? "Service metadata response." : "Compiler tool output.")
  };
  if (route.authRequired) {
    Object.assign(responses, jsonResponse("401", "Missing or invalid bearer token."));
  }
  if (route.method === "POST") {
    Object.assign(responses, jsonResponse("400", "Invalid JSON request body."));
    Object.assign(responses, jsonResponse("413", "Request body exceeds the service limit."));
    Object.assign(responses, jsonResponse("422", "Compiler tool validation or execution error."));
  }
  return responses;
}

function jsonResponse(status: string, description: string) {
  const schema = status === "200"
    ? { type: "object", additionalProperties: true }
    : { "$ref": "#/components/schemas/ErrorResponse" };
  return {
    [status]: {
      description,
      content: {
        "application/json": {
          schema
        }
      }
    }
  };
}
