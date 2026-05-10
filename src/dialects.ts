export type DialectProfileStatus = "stable" | "preview" | "experimental";

export interface DialectFeatureFlags {
  letClause: boolean;
  filterClause: boolean;
  subqueries: boolean;
  writeClauses: boolean;
  pathModes: boolean;
  shortestPathModes: boolean;
  gqlGraphReferences: boolean;
  legacyVariableLengthRelationships: boolean;
}

export interface DialectRenderingRules {
  escapeSchemaIdentifiers: boolean;
  relationshipRangeStyle: "legacy-star" | "gql-quantifier";
  requireReadonlyLimit: boolean;
}

export interface DialectProfile {
  version: "cypher-llm-dialect-profile/v1";
  id: "neo4j-cypher-25" | "opencypher-9" | "gql";
  displayName: string;
  status: DialectProfileStatus;
  description?: string;
  features: DialectFeatureFlags;
  rendering: DialectRenderingRules;
  unsupportedPatterns: string[];
  notes: string[];
}

export const dialectProfiles = [
  {
    version: "cypher-llm-dialect-profile/v1",
    id: "neo4j-cypher-25",
    displayName: "Neo4j Cypher 25",
    status: "stable",
    description: "Default profile for modern Neo4j Cypher with LLM-safe rendering.",
    features: {
      letClause: true,
      filterClause: true,
      subqueries: true,
      writeClauses: true,
      pathModes: true,
      shortestPathModes: true,
      gqlGraphReferences: false,
      legacyVariableLengthRelationships: true
    },
    rendering: {
      escapeSchemaIdentifiers: true,
      relationshipRangeStyle: "legacy-star",
      requireReadonlyLimit: true
    },
    unsupportedPatterns: [],
    notes: [
      "This is the package default profile.",
      "The renderer currently uses legacy star syntax for variable-length relationships for compatibility."
    ]
  },
  {
    version: "cypher-llm-dialect-profile/v1",
    id: "opencypher-9",
    displayName: "openCypher 9",
    status: "preview",
    description: "Compatibility-oriented profile for openCypher-style syntax.",
    features: {
      letClause: false,
      filterClause: false,
      subqueries: true,
      writeClauses: true,
      pathModes: false,
      shortestPathModes: false,
      gqlGraphReferences: false,
      legacyVariableLengthRelationships: true
    },
    rendering: {
      escapeSchemaIdentifiers: true,
      relationshipRangeStyle: "legacy-star",
      requireReadonlyLimit: true
    },
    unsupportedPatterns: ["LET clauses", "Cypher 25 FILTER clauses", "GQL path modes"],
    notes: [
      "Use this profile when targeting engines closer to the openCypher 9 grammar.",
      "The package does not yet enforce every profile-specific restriction."
    ]
  },
  {
    version: "cypher-llm-dialect-profile/v1",
    id: "gql",
    displayName: "GQL-Oriented Profile",
    status: "experimental",
    description: "Forward-looking profile for GQL-style rendering and compatibility checks.",
    features: {
      letClause: true,
      filterClause: true,
      subqueries: true,
      writeClauses: true,
      pathModes: true,
      shortestPathModes: true,
      gqlGraphReferences: true,
      legacyVariableLengthRelationships: false
    },
    rendering: {
      escapeSchemaIdentifiers: true,
      relationshipRangeStyle: "gql-quantifier",
      requireReadonlyLimit: true
    },
    unsupportedPatterns: ["Dialect-specific graph reference rendering is not implemented yet"],
    notes: ["This profile records intended compatibility behavior before the renderer fully targets GQL syntax."]
  }
] as const satisfies readonly DialectProfile[];

export type DialectProfileId = (typeof dialectProfiles)[number]["id"];

export function getDialectProfile(id: DialectProfileId): DialectProfile {
  const profile = dialectProfiles.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error(`Unknown Cypher dialect profile: ${id}`);
  }
  return profile;
}

export function listDialectProfiles(): DialectProfile[] {
  return [...dialectProfiles];
}
