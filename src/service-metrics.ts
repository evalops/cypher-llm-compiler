import type { CypherCompilerToolName } from "./tools.js";

export type CompilerServiceLiveDatabaseOutcomeStatus = "passed" | "warning" | "failed";

export interface CompilerServiceStatusCounts {
  passed: number;
  warning: number;
  failed: number;
}

export interface CompilerServiceSignalCounts {
  diagnostics: number;
  repairs: number;
  retryPackets: number;
  liveDatabaseOutcomes: CompilerServiceStatusCounts;
}

export interface CompilerServiceRouteMetrics {
  method: string;
  path: string;
  requests: number;
  succeeded: number;
  failed: number;
  statusCodes: Record<string, number>;
}

export interface CompilerServiceToolMetrics extends CompilerServiceSignalCounts {
  name: CypherCompilerToolName;
  requests: number;
  succeeded: number;
  failed: number;
}

export interface CompilerServiceMetricsReport {
  version: "cypher-llm-service-metrics/v1";
  generatedAt: string;
  service: {
    id: "cypher-llm-compiler-http";
    startedAt: string;
    uptimeMs: number;
  };
  requests: {
    total: number;
    succeeded: number;
    failed: number;
    unauthorized: number;
    statusCodes: Record<string, number>;
    byRoute: CompilerServiceRouteMetrics[];
  };
  tools: {
    total: number;
    succeeded: number;
    failed: number;
    byName: CompilerServiceToolMetrics[];
  };
  signals: CompilerServiceSignalCounts;
}

export interface CompilerServiceMetricsState {
  startedAt: string;
  requests: {
    total: number;
    succeeded: number;
    failed: number;
    unauthorized: number;
    statusCodes: Record<string, number>;
  };
  routes: Map<string, CompilerServiceRouteMetrics>;
  tools: Map<CypherCompilerToolName, CompilerServiceToolMetrics>;
  signals: CompilerServiceSignalCounts;
}

export interface CompilerServiceRequestMetricInput {
  method: string;
  path: string;
  statusCode: number;
  tool?: CypherCompilerToolName;
}

export function createCompilerServiceMetricsState(startedAt: Date = new Date()): CompilerServiceMetricsState {
  return {
    startedAt: startedAt.toISOString(),
    requests: {
      total: 0,
      succeeded: 0,
      failed: 0,
      unauthorized: 0,
      statusCodes: {}
    },
    routes: new Map(),
    tools: new Map(),
    signals: emptySignalCounts()
  };
}

export function buildEmptyCompilerServiceMetricsReport(): CompilerServiceMetricsReport {
  const at = new Date("2026-05-10T00:00:00.000Z");
  return snapshotCompilerServiceMetrics(createCompilerServiceMetricsState(at), at);
}

export function recordCompilerServiceRequest(
  state: CompilerServiceMetricsState,
  input: CompilerServiceRequestMetricInput
): void {
  const succeeded = input.statusCode < 400;
  state.requests.total += 1;
  if (succeeded) {
    state.requests.succeeded += 1;
  } else {
    state.requests.failed += 1;
  }
  if (input.statusCode === 401) {
    state.requests.unauthorized += 1;
  }
  incrementStatusCode(state.requests.statusCodes, input.statusCode);

  const routeKey = `${input.method} ${input.path}`;
  const route = state.routes.get(routeKey) ?? {
    method: input.method,
    path: input.path,
    requests: 0,
    succeeded: 0,
    failed: 0,
    statusCodes: {}
  };
  route.requests += 1;
  if (succeeded) {
    route.succeeded += 1;
  } else {
    route.failed += 1;
  }
  incrementStatusCode(route.statusCodes, input.statusCode);
  state.routes.set(routeKey, route);

  if (input.tool) {
    const tool = toolMetrics(state, input.tool);
    tool.requests += 1;
    if (succeeded) {
      tool.succeeded += 1;
    } else {
      tool.failed += 1;
    }
  }
}

export function recordCompilerServiceSignals(
  state: CompilerServiceMetricsState,
  value: unknown,
  toolName?: CypherCompilerToolName
): CompilerServiceSignalCounts {
  const signals = summarizeCompilerServiceSignals(value);
  addSignals(state.signals, signals);
  if (toolName) {
    addSignals(toolMetrics(state, toolName), signals);
  }
  return signals;
}

export function summarizeCompilerServiceSignals(value: unknown): CompilerServiceSignalCounts {
  const signals = emptySignalCounts();
  const seen = new Set<object>();

  function visit(item: unknown, key?: string): void {
    if (Array.isArray(item)) {
      if (key === "diagnostics") {
        signals.diagnostics += item.length;
      }
      if (key === "repairs" || key === "deterministic" || key === "modelRequired" || key === "unsafe") {
        signals.repairs += item.length;
      }
      for (const child of item) {
        visit(child);
      }
      return;
    }

    if (!item || typeof item !== "object") {
      return;
    }
    if (seen.has(item)) {
      return;
    }
    seen.add(item);

    const record = item as Record<string, unknown>;
    if (record.version === "cypher-llm-agent-feedback/v1" && record.nextAction !== undefined) {
      signals.retryPackets += 1;
    }

    if (record.kind === "live-database" && isLiveDatabaseStatus(record.status)) {
      signals.liveDatabaseOutcomes[record.status] += 1;
    }

    const plannerEstimate = record.plannerEstimate as Record<string, unknown> | undefined;
    if (plannerEstimate?.source === "neo4j-explain") {
      signals.liveDatabaseOutcomes.passed += 1;
    }

    for (const [childKey, child] of Object.entries(record)) {
      visit(child, childKey);
    }
  }

  visit(value);
  return signals;
}

export function snapshotCompilerServiceMetrics(
  state: CompilerServiceMetricsState,
  now: Date = new Date()
): CompilerServiceMetricsReport {
  return {
    version: "cypher-llm-service-metrics/v1",
    generatedAt: now.toISOString(),
    service: {
      id: "cypher-llm-compiler-http",
      startedAt: state.startedAt,
      uptimeMs: Math.max(0, now.getTime() - Date.parse(state.startedAt))
    },
    requests: {
      ...state.requests,
      statusCodes: { ...state.requests.statusCodes },
      byRoute: [...state.routes.values()]
        .map(cloneRouteMetrics)
        .sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`))
    },
    tools: {
      total: [...state.tools.values()].reduce((sum, tool) => sum + tool.requests, 0),
      succeeded: [...state.tools.values()].reduce((sum, tool) => sum + tool.succeeded, 0),
      failed: [...state.tools.values()].reduce((sum, tool) => sum + tool.failed, 0),
      byName: [...state.tools.values()].map(cloneToolMetrics).sort((left, right) => left.name.localeCompare(right.name))
    },
    signals: cloneSignalCounts(state.signals)
  };
}

function toolMetrics(state: CompilerServiceMetricsState, name: CypherCompilerToolName): CompilerServiceToolMetrics {
  const existing = state.tools.get(name);
  if (existing) {
    return existing;
  }
  const metrics: CompilerServiceToolMetrics = {
    name,
    requests: 0,
    succeeded: 0,
    failed: 0,
    ...emptySignalCounts()
  };
  state.tools.set(name, metrics);
  return metrics;
}

function emptySignalCounts(): CompilerServiceSignalCounts {
  return {
    diagnostics: 0,
    repairs: 0,
    retryPackets: 0,
    liveDatabaseOutcomes: {
      passed: 0,
      warning: 0,
      failed: 0
    }
  };
}

function addSignals(target: CompilerServiceSignalCounts, input: CompilerServiceSignalCounts): void {
  target.diagnostics += input.diagnostics;
  target.repairs += input.repairs;
  target.retryPackets += input.retryPackets;
  target.liveDatabaseOutcomes.passed += input.liveDatabaseOutcomes.passed;
  target.liveDatabaseOutcomes.warning += input.liveDatabaseOutcomes.warning;
  target.liveDatabaseOutcomes.failed += input.liveDatabaseOutcomes.failed;
}

function cloneSignalCounts(input: CompilerServiceSignalCounts): CompilerServiceSignalCounts {
  return {
    diagnostics: input.diagnostics,
    repairs: input.repairs,
    retryPackets: input.retryPackets,
    liveDatabaseOutcomes: { ...input.liveDatabaseOutcomes }
  };
}

function cloneRouteMetrics(input: CompilerServiceRouteMetrics): CompilerServiceRouteMetrics {
  return {
    ...input,
    statusCodes: { ...input.statusCodes }
  };
}

function cloneToolMetrics(input: CompilerServiceToolMetrics): CompilerServiceToolMetrics {
  return {
    ...input,
    liveDatabaseOutcomes: { ...input.liveDatabaseOutcomes }
  };
}

function incrementStatusCode(statusCodes: Record<string, number>, statusCode: number): void {
  const key = String(statusCode);
  statusCodes[key] = (statusCodes[key] ?? 0) + 1;
}

function isLiveDatabaseStatus(status: unknown): status is CompilerServiceLiveDatabaseOutcomeStatus {
  return status === "passed" || status === "warning" || status === "failed";
}
