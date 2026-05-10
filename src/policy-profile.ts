import type { CypherPolicyOptions } from "./policy.js";

export interface CypherPolicyProfile {
  version: "cypher-llm-policy-profile/v1";
  id: string;
  title: string;
  description?: string;
  options: Omit<CypherPolicyOptions, "profile">;
}

export interface CypherPolicyProfileCatalog {
  version: "cypher-llm-policy-profile-catalog/v1";
  profiles: CypherPolicyProfile[];
}

export const builtinPolicyProfiles = [
  {
    version: "cypher-llm-policy-profile/v1",
    id: "llm-readonly-strict",
    title: "LLM Readonly Strict",
    description: "Default autonomous-agent read policy: no writes, required LIMIT, modest row and traversal ceilings.",
    options: {
      allowWrites: false,
      requireLimit: true,
      maxReturnLimit: 100,
      maxRelationshipHops: 5
    }
  },
  {
    version: "cypher-llm-policy-profile/v1",
    id: "llm-readonly-exploration",
    title: "LLM Readonly Exploration",
    description: "Read-only exploration profile with wider row and traversal ceilings while still requiring bounded results.",
    options: {
      allowWrites: false,
      requireLimit: true,
      maxReturnLimit: 500,
      maxRelationshipHops: 8
    }
  },
  {
    version: "cypher-llm-policy-profile/v1",
    id: "approved-write-maintenance",
    title: "Approved Write Maintenance",
    description: "Maintenance profile for externally approved write workflows with explicit result limits.",
    options: {
      allowWrites: true,
      requireLimit: true,
      maxReturnLimit: 100,
      maxRelationshipHops: 5
    }
  }
] as const satisfies readonly CypherPolicyProfile[];

export function buildPolicyProfileCatalog(): CypherPolicyProfileCatalog {
  return {
    version: "cypher-llm-policy-profile-catalog/v1",
    profiles: cloneProfiles(builtinPolicyProfiles)
  };
}

export function getPolicyProfile(id: string): CypherPolicyProfile {
  const profile = builtinPolicyProfiles.find((item) => item.id === id);
  if (!profile) {
    throw new Error(`Unknown policy profile '${id}'.`);
  }
  return cloneProfile(profile);
}

export function policyOptionsFromProfile(
  profile: CypherPolicyProfile,
  overrides: Omit<CypherPolicyOptions, "profile"> = {}
): CypherPolicyOptions {
  return {
    ...profile.options,
    ...overrides,
    profile: {
      id: profile.id,
      title: profile.title
    }
  };
}

export function renderPolicyProfileCatalogMarkdown(catalog: CypherPolicyProfileCatalog): string {
  const rows = [
    "| Profile | Writes | LIMIT Required | Max LIMIT | Max Hops |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...catalog.profiles.map((profile) =>
      [
        `| \`${profile.id}\``,
        profile.options.allowWrites === true ? "allowed" : "blocked",
        profile.options.requireLimit === false ? "no" : "yes",
        profile.options.maxReturnLimit ?? "default",
        profile.options.maxRelationshipHops ?? "default"
      ].join(" | ") + " |"
    )
  ];
  return [`# Cypher Policy Profiles`, "", ...rows, ""].join("\n");
}

function cloneProfiles(profiles: readonly CypherPolicyProfile[]): CypherPolicyProfile[] {
  return profiles.map(cloneProfile);
}

function cloneProfile(profile: CypherPolicyProfile): CypherPolicyProfile {
  return JSON.parse(JSON.stringify(profile)) as CypherPolicyProfile;
}
