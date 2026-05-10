import type {
  CypherSchemaContract,
  SchemaNode,
  SchemaParameter,
  SchemaProcedure,
  SchemaProperty,
  SchemaRelationship
} from "./ir.js";

export interface IdentifierInfo {
  kind: "label" | "relationship" | "property" | "parameter";
  name: string;
  cypher: string;
  aliases: string[];
}

export interface NormalizedSchema {
  original: CypherSchemaContract;
  dialect: string;
  nodes: SchemaNode[];
  relationships: SchemaRelationship[];
  parameters: Map<string, SchemaParameter>;
  procedures: Map<string, SchemaProcedure>;
  nodeByName: Map<string, SchemaNode>;
  relationshipByType: Map<string, SchemaRelationship>;
  labelAliases: Map<string, string>;
  relationshipAliases: Map<string, string>;
  propertyAliases: Map<string, string>;
  identifiers: {
    labels: Map<string, IdentifierInfo>;
    relationships: Map<string, IdentifierInfo>;
    properties: Map<string, IdentifierInfo>;
    parameters: Map<string, IdentifierInfo>;
  };
}

const CYPHER_KEYWORDS = new Set(
  [
    "ALL",
    "AND",
    "ANY",
    "AS",
    "ASC",
    "ASCENDING",
    "BY",
    "CALL",
    "CASE",
    "CONTAINS",
    "CREATE",
    "DELETE",
    "DESC",
    "DESCENDING",
    "DETACH",
    "DISTINCT",
    "ELSE",
    "END",
    "ENDS",
    "EXISTS",
    "FALSE",
    "FILTER",
    "FINISH",
    "FOREACH",
    "IN",
    "IS",
    "LET",
    "LIMIT",
    "MATCH",
    "MERGE",
    "NOT",
    "NULL",
    "OPTIONAL",
    "OR",
    "ORDER",
    "REMOVE",
    "RETURN",
    "SET",
    "SKIP",
    "STARTS",
    "THEN",
    "TRUE",
    "UNION",
    "UNWIND",
    "WHEN",
    "WHERE",
    "WITH",
    "XOR",
    "YIELD"
  ].map((keyword) => keyword.toUpperCase())
);

export function normalizeSchema(schema: CypherSchemaContract): NormalizedSchema {
  const nodeByName = new Map<string, SchemaNode>();
  const relationshipByType = new Map<string, SchemaRelationship>();
  const labelAliases = new Map<string, string>();
  const relationshipAliases = new Map<string, string>();
  const propertyAliases = new Map<string, string>();
  const parameters = new Map<string, SchemaParameter>();
  const procedures = new Map<string, SchemaProcedure>();
  const labelIdentifiers = new Map<string, IdentifierInfo>();
  const relationshipIdentifiers = new Map<string, IdentifierInfo>();
  const propertyIdentifiers = new Map<string, IdentifierInfo>();
  const parameterIdentifiers = new Map<string, IdentifierInfo>();

  for (const node of schema.nodes) {
    nodeByName.set(node.name, node);
    registerLookup(labelAliases, node.name, node.name);
    for (const alias of node.aliases ?? []) {
      registerLookup(labelAliases, alias, node.name);
    }
    labelIdentifiers.set(node.name, identifierInfo("label", node.name, node.aliases ?? []));
    registerProperties(propertyAliases, propertyIdentifiers, `node:${node.name}`, node.properties);
  }

  for (const relationship of schema.relationships) {
    relationshipByType.set(relationship.type, relationship);
    registerLookup(relationshipAliases, relationship.type, relationship.type);
    for (const alias of relationship.aliases ?? []) {
      registerLookup(relationshipAliases, alias, relationship.type);
    }
    relationshipIdentifiers.set(
      relationship.type,
      identifierInfo("relationship", relationship.type, relationship.aliases ?? [])
    );
    registerProperties(
      propertyAliases,
      propertyIdentifiers,
      `relationship:${relationship.type}`,
      relationship.properties
    );
  }

  for (const [name, parameter] of Object.entries(schema.parameters ?? {})) {
    const normalized = typeof parameter === "string" ? { type: parameter } : parameter;
    parameters.set(name, normalized);
    parameterIdentifiers.set(name, identifierInfo("parameter", name, []));
  }

  for (const [name, procedure] of Object.entries(schema.procedures ?? {})) {
    procedures.set(lookupKey(name), procedure);
  }

  return {
    original: schema,
    dialect: schema.dialect ?? "neo4j-cypher-25",
    nodes: schema.nodes,
    relationships: schema.relationships,
    parameters,
    procedures,
    nodeByName,
    relationshipByType,
    labelAliases,
    relationshipAliases,
    propertyAliases,
    identifiers: {
      labels: labelIdentifiers,
      relationships: relationshipIdentifiers,
      properties: propertyIdentifiers,
      parameters: parameterIdentifiers
    }
  };
}

export function resolveLabel(schema: NormalizedSchema, nameOrAlias: string): SchemaNode | undefined {
  const canonical = schema.labelAliases.get(lookupKey(nameOrAlias)) ?? nameOrAlias;
  return schema.nodeByName.get(canonical);
}

export function resolveRelationshipType(
  schema: NormalizedSchema,
  typeOrAlias: string
): SchemaRelationship | undefined {
  const canonical = schema.relationshipAliases.get(lookupKey(typeOrAlias)) ?? typeOrAlias;
  return schema.relationshipByType.get(canonical);
}

export function canonicalLabel(schema: NormalizedSchema, nameOrAlias: string): string | undefined {
  return resolveLabel(schema, nameOrAlias)?.name;
}

export function canonicalRelationshipType(schema: NormalizedSchema, typeOrAlias: string): string | undefined {
  return resolveRelationshipType(schema, typeOrAlias)?.type;
}

export function resolveProcedure(schema: NormalizedSchema, name: string): SchemaProcedure | undefined {
  return schema.procedures.get(lookupKey(name));
}

export function resolveProperty(
  schema: NormalizedSchema,
  ownerKind: "node" | "relationship" | "any",
  ownerName: string | undefined,
  propertyOrAlias: string
): SchemaProperty | undefined {
  const canonicalOwner = ownerName ? canonicalOwnerName(schema, ownerKind, ownerName) : undefined;
  const aliasKey = canonicalOwner
    ? `${ownerKind}:${canonicalOwner}:${lookupKey(propertyOrAlias)}`
    : `any:${lookupKey(propertyOrAlias)}`;
  const resolved = schema.propertyAliases.get(aliasKey);
  if (resolved && canonicalOwner) {
    return propertyForOwner(schema, ownerKind, canonicalOwner, resolved);
  }

  if (canonicalOwner) {
    return propertyForOwner(schema, ownerKind, canonicalOwner, propertyOrAlias);
  }

  const matches = collectProperties(schema, propertyOrAlias);
  return matches.length === 1 ? matches[0] : undefined;
}

export function cypherIdentifier(name: string, options: { alwaysEscape?: boolean } = {}): string {
  const alwaysEscape = options.alwaysEscape ?? true;
  if (!alwaysEscape && isBareIdentifier(name) && !CYPHER_KEYWORDS.has(name.toUpperCase())) {
    return name;
  }
  return `\`${name.replaceAll("`", "``")}\``;
}

export function isBareIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function lookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function registerProperties(
  propertyAliases: Map<string, string>,
  propertyIdentifiers: Map<string, IdentifierInfo>,
  ownerKey: string,
  properties: Record<string, SchemaProperty> | undefined
) {
  for (const [name, property] of Object.entries(properties ?? {})) {
    registerLookup(propertyAliases, `${ownerKey}:${name}`, name);
    registerLookup(propertyAliases, `any:${name}`, name);
    for (const alias of property.aliases ?? []) {
      registerLookup(propertyAliases, `${ownerKey}:${alias}`, name);
      registerLookup(propertyAliases, `any:${alias}`, name);
    }
    propertyIdentifiers.set(`${ownerKey}:${name}`, identifierInfo("property", name, property.aliases ?? []));
  }
}

function registerLookup(target: Map<string, string>, key: string, canonical: string) {
  target.set(lookupKey(key), canonical);
}

function identifierInfo(kind: IdentifierInfo["kind"], name: string, aliases: string[]): IdentifierInfo {
  return {
    kind,
    name,
    cypher: cypherIdentifier(name),
    aliases
  };
}

function canonicalOwnerName(
  schema: NormalizedSchema,
  ownerKind: "node" | "relationship" | "any",
  ownerName: string
): string | undefined {
  if (ownerKind === "node") {
    return canonicalLabel(schema, ownerName);
  }
  if (ownerKind === "relationship") {
    return canonicalRelationshipType(schema, ownerName);
  }
  return ownerName;
}

function propertyForOwner(
  schema: NormalizedSchema,
  ownerKind: "node" | "relationship" | "any",
  ownerName: string,
  propertyName: string
): SchemaProperty | undefined {
  if (ownerKind === "node") {
    return schema.nodeByName.get(ownerName)?.properties?.[propertyName];
  }
  if (ownerKind === "relationship") {
    return schema.relationshipByType.get(ownerName)?.properties?.[propertyName];
  }
  return undefined;
}

function collectProperties(schema: NormalizedSchema, propertyName: string): SchemaProperty[] {
  const properties: SchemaProperty[] = [];
  for (const node of schema.nodes) {
    const property = node.properties?.[propertyName];
    if (property) {
      properties.push(property);
    }
  }
  for (const relationship of schema.relationships) {
    const property = relationship.properties?.[propertyName];
    if (property) {
      properties.push(property);
    }
  }
  return properties;
}
