import type { CypherSchemaContract } from "./ir.js";

export type CypherSchemaStatisticsSource = "neo4j-introspection" | "manual" | "fixture";

export interface CypherNodeLabelStatistics {
  label: string;
  count?: number;
  indexedProperties?: string[];
}

export interface CypherRelationshipTypeStatistics {
  type: string;
  count?: number;
  averageFanout?: number;
}

export interface CypherSchemaStatistics {
  version: "cypher-llm-schema-statistics/v1";
  source: CypherSchemaStatisticsSource;
  nodes: CypherNodeLabelStatistics[];
  relationships: CypherRelationshipTypeStatistics[];
}

export function buildSchemaStatisticsSkeleton(
  schema: CypherSchemaContract,
  source: CypherSchemaStatisticsSource = "manual"
): CypherSchemaStatistics {
  return {
    version: "cypher-llm-schema-statistics/v1",
    source,
    nodes: schema.nodes.map((node) => ({ label: node.name })),
    relationships: schema.relationships.map((relationship) => ({ type: relationship.type }))
  };
}

export function findNodeStatistics(
  statistics: CypherSchemaStatistics,
  label: string
): CypherNodeLabelStatistics | undefined {
  return statistics.nodes.find((node) => node.label === label);
}

export function findRelationshipStatistics(
  statistics: CypherSchemaStatistics,
  type: string
): CypherRelationshipTypeStatistics | undefined {
  return statistics.relationships.find((relationship) => relationship.type === type);
}

export function hasIndexedProperty(statistics: CypherNodeLabelStatistics, property: string): boolean {
  return statistics.indexedProperties?.includes(property) ?? false;
}
