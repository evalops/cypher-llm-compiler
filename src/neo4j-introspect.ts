import type {
  CypherSchemaContract,
  CypherType,
  JsonLiteral,
  SchemaNode,
  SchemaProcedure,
  SchemaProperty,
  SchemaRelationship
} from "./ir.js";

export interface Neo4jIntrospectionRecordLike {
  get(key: string | number): unknown;
  toObject?(): Record<string, unknown>;
}

export interface Neo4jIntrospectionRunResultLike {
  records?: Neo4jIntrospectionRecordLike[];
}

export interface Neo4jIntrospectionSessionLike {
  run(cypher: string, params?: Record<string, JsonLiteral>): Promise<Neo4jIntrospectionRunResultLike>;
}

export interface Neo4jIntrospectionOptions {
  dialect?: string;
  sampleLimit?: number;
  includeProcedures?: boolean;
}

interface MutableNode {
  name: string;
  properties: Record<string, SchemaProperty>;
}

interface MutableRelationship {
  type: string;
  from: Set<string>;
  to: Set<string>;
  properties: Record<string, SchemaProperty>;
}

export async function introspectNeo4jSchema(
  session: Neo4jIntrospectionSessionLike,
  options: Neo4jIntrospectionOptions = {}
): Promise<CypherSchemaContract> {
  const nodes = new Map<string, MutableNode>();
  const relationships = new Map<string, MutableRelationship>();

  await collectNodeProperties(session, nodes);
  await collectRelationshipProperties(session, relationships);
  await collectRelationshipEndpoints(session, nodes, relationships, options.sampleLimit ?? 1000);
  const procedures = options.includeProcedures === false ? {} : await collectProcedures(session);

  return {
    version: "cypher-llm-schema/v1",
    dialect: options.dialect ?? "neo4j-cypher-25",
    nodes: [...nodes.values()].map((node) => ({
      name: node.name,
      ...(Object.keys(node.properties).length > 0 ? { properties: sortObject(node.properties) } : {})
    })),
    relationships: [...relationships.values()].map((relationship) => ({
      type: relationship.type,
      from: endpointValue(relationship.from),
      to: endpointValue(relationship.to),
      ...(Object.keys(relationship.properties).length > 0 ? { properties: sortObject(relationship.properties) } : {})
    })),
    ...(Object.keys(procedures).length > 0 ? { procedures: sortObject(procedures) } : {})
  };
}

async function collectNodeProperties(session: Neo4jIntrospectionSessionLike, nodes: Map<string, MutableNode>) {
  const result = await session.run(
    "CALL db.schema.nodeTypeProperties() YIELD nodeType, propertyName, propertyTypes, mandatory RETURN nodeType, propertyName, propertyTypes, mandatory"
  );
  for (const record of result.records ?? []) {
    const propertyName = asString(recordValue(record, "propertyName"));
    if (!propertyName) {
      continue;
    }
    for (const label of labelsFromNodeType(asString(recordValue(record, "nodeType")))) {
      const node = ensureNode(nodes, label);
      node.properties[propertyName] = propertyFromRecord(record);
    }
  }
}

async function collectRelationshipProperties(
  session: Neo4jIntrospectionSessionLike,
  relationships: Map<string, MutableRelationship>
) {
  const result = await session.run(
    "CALL db.schema.relTypeProperties() YIELD relType, propertyName, propertyTypes, mandatory RETURN relType, propertyName, propertyTypes, mandatory"
  );
  for (const record of result.records ?? []) {
    const type = relationshipTypeFromRelType(asString(recordValue(record, "relType")));
    const propertyName = asString(recordValue(record, "propertyName"));
    if (!type || !propertyName) {
      continue;
    }
    const relationship = ensureRelationship(relationships, type);
    relationship.properties[propertyName] = propertyFromRecord(record);
  }
}

async function collectRelationshipEndpoints(
  session: Neo4jIntrospectionSessionLike,
  nodes: Map<string, MutableNode>,
  relationships: Map<string, MutableRelationship>,
  sampleLimit: number
) {
  const result = await session.run(
    "MATCH (from)-[rel]->(to) RETURN DISTINCT labels(from) AS fromLabels, type(rel) AS type, labels(to) AS toLabels LIMIT $sampleLimit",
    { sampleLimit }
  );
  for (const record of result.records ?? []) {
    const type = asString(recordValue(record, "type"));
    if (!type) {
      continue;
    }
    const relationship = ensureRelationship(relationships, type);
    for (const label of asStringArray(recordValue(record, "fromLabels"))) {
      ensureNode(nodes, label);
      relationship.from.add(label);
    }
    for (const label of asStringArray(recordValue(record, "toLabels"))) {
      ensureNode(nodes, label);
      relationship.to.add(label);
    }
  }
}

async function collectProcedures(session: Neo4jIntrospectionSessionLike): Promise<Record<string, SchemaProcedure>> {
  const result = await session.run(
    "SHOW PROCEDURES YIELD name, description, signature, returnDescription RETURN name, description, signature, returnDescription"
  );
  const procedures: Record<string, SchemaProcedure> = {};
  for (const record of result.records ?? []) {
    const name = asString(recordValue(record, "name"));
    if (!name) {
      continue;
    }
    const description = asString(recordValue(record, "description"));
    const returns = parseProcedureReturns(asString(recordValue(record, "returnDescription")));
    procedures[name] = {
      ...(description ? { description } : {}),
      ...(Object.keys(returns).length > 0 ? { yields: returns } : {})
    };
  }
  return procedures;
}

function ensureNode(nodes: Map<string, MutableNode>, name: string): MutableNode {
  const existing = nodes.get(name);
  if (existing) {
    return existing;
  }
  const node = { name, properties: {} };
  nodes.set(name, node);
  return node;
}

function ensureRelationship(relationships: Map<string, MutableRelationship>, type: string): MutableRelationship {
  const existing = relationships.get(type);
  if (existing) {
    return existing;
  }
  const relationship = { type, from: new Set<string>(), to: new Set<string>(), properties: {} };
  relationships.set(type, relationship);
  return relationship;
}

function propertyFromRecord(record: Neo4jIntrospectionRecordLike): SchemaProperty {
  return {
    type: cypherTypeFromNeo4jTypes(asStringArray(recordValue(record, "propertyTypes"))),
    nullable: !asBoolean(recordValue(record, "mandatory"))
  };
}

function parseProcedureReturns(returnDescription: string | undefined): Record<string, CypherType | SchemaProperty> {
  if (!returnDescription) {
    return {};
  }
  const yields: Record<string, CypherType | SchemaProperty> = {};
  for (const part of returnDescription.split(",")) {
    const match = /^\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s+::\s+(.+?)\??\s*$/.exec(part);
    if (match?.[1] && match[2]) {
      yields[match[1]] = neo4jTypeToCypherType(match[2]);
    }
  }
  return yields;
}

function cypherTypeFromNeo4jTypes(types: string[]): CypherType {
  const normalized = types.map(neo4jTypeToCypherType).filter((type) => type.length > 0);
  if (normalized.length === 0) {
    return "ANY";
  }
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  return unique.length === 1 ? unique[0] ?? "ANY" : unique.join(" | ");
}

function neo4jTypeToCypherType(type: string): CypherType {
  const normalized = type.trim().replace(/\?$/, "");
  const lower = normalized.toLowerCase();
  if (lower === "string") return "STRING";
  if (lower === "boolean") return "BOOLEAN";
  if (lower === "integer" || lower === "long") return "INTEGER";
  if (lower === "float" || lower === "double") return "FLOAT";
  if (lower === "date") return "DATE";
  if (lower === "time") return "ZONED_TIME";
  if (lower === "localtime") return "LOCAL_TIME";
  if (lower === "datetime") return "ZONED_DATETIME";
  if (lower === "localdatetime") return "LOCAL_DATETIME";
  if (lower === "duration") return "DURATION";
  if (lower === "point") return "POINT";
  if (lower.startsWith("list")) return `LIST<${normalized.slice(normalized.indexOf("<") + 1, normalized.lastIndexOf(">")) || "ANY"}>`;
  return normalized.toUpperCase();
}

function labelsFromNodeType(nodeType: string | undefined): string[] {
  if (!nodeType) {
    return [];
  }
  return [...nodeType.matchAll(/:`([^`]+)`|:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1] ?? match[2] ?? "");
}

function relationshipTypeFromRelType(relType: string | undefined): string | undefined {
  if (!relType) {
    return undefined;
  }
  const backtick = /^:`(.+)`$/.exec(relType);
  if (backtick?.[1]) {
    return backtick[1];
  }
  return relType.replace(/^:/, "");
}

function endpointValue(labels: Set<string>): string | string[] {
  const sorted = [...labels].sort((left, right) => left.localeCompare(right));
  if (sorted.length === 0) {
    return "UNKNOWN";
  }
  return sorted.length === 1 ? sorted[0] ?? "UNKNOWN" : sorted;
}

function recordValue(record: Neo4jIntrospectionRecordLike, key: string): unknown {
  try {
    return record.get(key);
  } catch {
    return record.toObject?.()[key];
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(asString).filter(isString);
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function sortObject<T>(input: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
