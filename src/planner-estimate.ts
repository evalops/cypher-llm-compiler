export type CypherPlannerEstimateSource = "neo4j-explain" | "neo4j-profile" | "manual" | "fixture";

export interface CypherPlannerOperatorEstimate {
  name: string;
  identifiers?: string[];
  estimatedRows?: number;
  dbHits?: number;
  children?: CypherPlannerOperatorEstimate[];
}

export interface CypherPlannerEstimate {
  version: "cypher-llm-planner-estimate/v1";
  source: CypherPlannerEstimateSource;
  estimatedRows?: number;
  dbHits?: number;
  operators: CypherPlannerOperatorEstimate[];
  warnings?: string[];
}

export function buildPlannerEstimateFromNeo4jSummary(
  summary: unknown,
  source: CypherPlannerEstimateSource = "neo4j-explain"
): CypherPlannerEstimate {
  const root = planRoot(summary);
  if (!root) {
    return {
      version: "cypher-llm-planner-estimate/v1",
      source,
      operators: [],
      warnings: ["No Neo4j plan or profile tree was found in the summary."]
    };
  }

  const operator = operatorEstimate(root);
  const operators = [operator];
  const flattened = flattenPlannerOperators(operators);
  const estimatedRows = maxNumber(flattened.map((item) => item.estimatedRows));
  const dbHits = sumNumbers(flattened.map((item) => item.dbHits));

  return {
    version: "cypher-llm-planner-estimate/v1",
    source,
    ...(estimatedRows !== undefined ? { estimatedRows } : {}),
    ...(dbHits !== undefined ? { dbHits } : {}),
    operators
  };
}

export function flattenPlannerOperators(operators: readonly CypherPlannerOperatorEstimate[]): CypherPlannerOperatorEstimate[] {
  const flattened: CypherPlannerOperatorEstimate[] = [];
  for (const operator of operators) {
    flattened.push(operator);
    flattened.push(...flattenPlannerOperators(operator.children ?? []));
  }
  return flattened;
}

function planRoot(summary: unknown): unknown {
  if (!isRecord(summary)) {
    return undefined;
  }
  const directPlan = summary.plan ?? summary.profile;
  if (directPlan !== undefined) {
    return directPlan;
  }
  const nestedSummary = summary.summary;
  if (isRecord(nestedSummary)) {
    return nestedSummary.plan ?? nestedSummary.profile;
  }
  return undefined;
}

function operatorEstimate(value: unknown): CypherPlannerOperatorEstimate {
  const node = isRecord(value) ? value : {};
  const args = isRecord(node.arguments) ? node.arguments : {};
  const name = stringValue(node.operatorType) ?? stringValue(node.operator) ?? stringValue(node.name) ?? "UnknownOperator";
  const identifiers = stringArray(node.identifiers);
  const estimatedRows = numberArgument(args, "EstimatedRows") ?? numberArgument(args, "estimatedRows") ?? numberArgument(node, "estimatedRows");
  const dbHits = numberArgument(args, "DbHits") ?? numberArgument(args, "dbHits") ?? numberArgument(node, "dbHits");
  const children = Array.isArray(node.children) ? node.children.map(operatorEstimate) : [];

  return {
    name,
    ...(identifiers.length > 0 ? { identifiers } : {}),
    ...(estimatedRows !== undefined ? { estimatedRows } : {}),
    ...(dbHits !== undefined ? { dbHits } : {}),
    ...(children.length > 0 ? { children } : {})
  };
}

function numberArgument(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function maxNumber(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined);
  return numbers.length > 0 ? Math.max(...numbers) : undefined;
}

function sumNumbers(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined);
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
