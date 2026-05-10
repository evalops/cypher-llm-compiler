import {
  getDialectProfile,
  listDialectProfiles,
  type DialectProfile,
  type DialectProfileId,
  type DialectProfileStatus
} from "./dialects.js";
import type { CypherQuery, CypherSchemaContract } from "./ir.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import { renderQueryForDialect } from "./render.js";
import { validateQuery } from "./validate.js";

export type CertificationStatus = "passed" | "warning" | "failed";
export type CertificationCheckKind = "profile" | "renderer" | "semantic" | "parser" | "live-database";

export interface DialectLiveDatabaseEvidence {
  profileId: DialectProfileId;
  status: CertificationStatus;
  database: string;
  source: string;
  observed?: string;
  diagnostics?: string[];
  cypher?: string;
}

export interface DialectLiveDatabaseEvidenceSet {
  version: "cypher-llm-dialect-live-evidence/v1";
  generatedAt: string;
  summary: {
    evidenceProfiles: number;
    passedEvidence: number;
    warningEvidence: number;
    failedEvidence: number;
    databases: string[];
  };
  evidence: DialectLiveDatabaseEvidence[];
}

export type DialectLiveDatabaseEvidenceInput = DialectLiveDatabaseEvidence[] | DialectLiveDatabaseEvidenceSet;

export interface DialectCertificationOptions {
  liveDatabaseEvidence?: DialectLiveDatabaseEvidenceInput;
}

export interface DialectCertificationCheck {
  id: string;
  title: string;
  kind: CertificationCheckKind;
  status: CertificationStatus;
  expected: string;
  observed: string;
  evidence: string[];
  diagnostics: string[];
  cypher?: string;
}

export interface DialectCertificationProfileReport {
  profileId: DialectProfileId;
  displayName: string;
  profileStatus: DialectProfileStatus;
  status: CertificationStatus;
  checks: DialectCertificationCheck[];
}

export interface DialectCertificationSummary {
  profiles: number;
  passedProfiles: number;
  warningProfiles: number;
  failedProfiles: number;
  checks: number;
  passedChecks: number;
  warningChecks: number;
  failedChecks: number;
}

export interface DialectCertificationReport {
  version: "cypher-llm-dialect-certification/v1";
  generatedAt: string;
  summary: DialectCertificationSummary;
  profiles: DialectCertificationProfileReport[];
}

const GENERATED_AT = "2026-05-10";

export function certifyDialectProfiles(
  profileIds?: DialectProfileId[],
  options: DialectCertificationOptions = {}
): DialectCertificationReport {
  const selectedProfiles = profileIds?.length
    ? profileIds.map((id) => getDialectProfile(id))
    : listDialectProfiles();
  const profiles = selectedProfiles.map((profile) => certifyProfile(profile, options));
  const checks = profiles.flatMap((profile) => profile.checks);

  return {
    version: "cypher-llm-dialect-certification/v1",
    generatedAt: GENERATED_AT,
    summary: {
      profiles: profiles.length,
      passedProfiles: profiles.filter((profile) => profile.status === "passed").length,
      warningProfiles: profiles.filter((profile) => profile.status === "warning").length,
      failedProfiles: profiles.filter((profile) => profile.status === "failed").length,
      checks: checks.length,
      passedChecks: checks.filter((check) => check.status === "passed").length,
      warningChecks: checks.filter((check) => check.status === "warning").length,
      failedChecks: checks.filter((check) => check.status === "failed").length
    },
    profiles
  };
}

export function normalizeDialectLiveDatabaseEvidence(
  input?: DialectLiveDatabaseEvidenceInput
): DialectLiveDatabaseEvidence[] {
  if (!input) {
    return [];
  }
  return Array.isArray(input) ? input : input.evidence;
}

export function renderDialectCertificationMarkdown(report: DialectCertificationReport = certifyDialectProfiles()): string {
  const lines = [
    "# Dialect Certification",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Profiles: ${report.summary.profiles}; checks: ${report.summary.checks}; failures: ${report.summary.failedChecks}; warnings: ${report.summary.warningChecks}`,
    ""
  ];

  for (const profile of report.profiles) {
    lines.push(`## ${profile.displayName}`, "", `Status: ${profile.status}`, "");
    for (const check of profile.checks) {
      lines.push(
        `- ${check.id}: ${check.status} - ${check.title}`,
        `  Expected: ${check.expected}`,
        `  Observed: ${check.observed}`
      );
      if (check.diagnostics.length > 0) {
        lines.push(`  Diagnostics: ${check.diagnostics.join(", ")}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function certifyProfile(profile: DialectProfile, options: DialectCertificationOptions): DialectCertificationProfileReport {
  const liveDatabaseEvidence = normalizeDialectLiveDatabaseEvidence(options.liveDatabaseEvidence);
  const checks = [
    checkProfileMetadata(profile),
    checkRendererEscapes(profile),
    checkParserAcceptsRenderedRead(profile),
    checkLetFeature(profile),
    checkPathModeFeature(profile),
    checkRelationshipRangeRendering(profile),
    checkLiveDatabaseEvidence(profile, liveDatabaseEvidence)
  ];

  return {
    profileId: profile.id,
    displayName: profile.displayName,
    profileStatus: profile.status,
    status: aggregateStatus(checks.map((check) => check.status)),
    checks
  };
}

function checkProfileMetadata(profile: DialectProfile): DialectCertificationCheck {
  const hasNotes = profile.notes.length > 0;
  const hasUnsupportedPatterns = Array.isArray(profile.unsupportedPatterns);
  return {
    id: "profile-metadata",
    title: "Profile records status, notes, and unsupported patterns",
    kind: "profile",
    status: hasNotes && hasUnsupportedPatterns ? "passed" : "failed",
    expected: "Profile metadata is explicit enough for LLM clients to inspect before generating Cypher.",
    observed: hasNotes && hasUnsupportedPatterns ? "metadata present" : "metadata incomplete",
    evidence: [`profiles/${profile.id}.json`, "src/dialects.ts"],
    diagnostics: hasNotes && hasUnsupportedPatterns ? [] : ["profile-metadata-incomplete"]
  };
}

function checkRendererEscapes(profile: DialectProfile): DialectCertificationCheck {
  const query: CypherQuery = {
    version: "cypher-llm-ir/v1",
    clauses: [
      {
        kind: "match",
        patterns: [
          {
            segments: [
              {
                variable: "tool",
                labels: ["Tool Hash"],
                properties: { "hash value": { kind: "literal", value: "abc" } }
              }
            ]
          }
        ]
      },
      { kind: "return", items: [{ expression: { kind: "var", name: "tool" } }], limit: { kind: "literal", value: 1 } }
    ]
  };
  const cypher = renderQueryForDialect(query, profile.id);
  const escaped = cypher.includes("`Tool Hash`") && cypher.includes("`hash value`");

  return {
    id: "renderer-escapes-schema-identifiers",
    title: "Renderer escapes schema identifiers that LLMs commonly break",
    kind: "renderer",
    status: escaped ? "passed" : "failed",
    expected: "Rendered Cypher backtick-escapes labels and properties with spaces.",
    observed: escaped ? "schema identifiers escaped" : "schema identifiers not escaped",
    evidence: ["src/render.ts", "test/render.test.ts"],
    diagnostics: escaped ? [] : ["unescaped-schema-identifier"],
    cypher
  };
}

function checkParserAcceptsRenderedRead(profile: DialectProfile): DialectCertificationCheck {
  const schema = schemaForProfile(profile.id);
  const query = baseReadQuery();
  const cypher = renderQueryForDialect(query, profile.id);
  const parser = validateCypherTextWithParser(cypher, schema, { mode: "syntax" });
  const diagnostics = parser.diagnostics.map((diagnostic) => diagnostic.code);

  return {
    id: "parser-accepts-rendered-read",
    title: "Parser accepts renderer output for a bounded read query",
    kind: "parser",
    status: parser.ok ? "passed" : "failed",
    expected: "Rendered read query is syntactically accepted by the parser adapter.",
    observed: parser.ok ? "parser accepted rendered query" : "parser rejected rendered query",
    evidence: ["src/parser-validation.ts", "test/parser-validation.test.ts"],
    diagnostics,
    cypher
  };
}

function checkLetFeature(profile: DialectProfile): DialectCertificationCheck {
  const validation = validateQuery(letQuery(), schemaForProfile(profile.id), { dialect: profile.id });
  const hasUnsupported = validation.diagnostics.some((diagnostic) => diagnostic.code === "dialect-unsupported-feature");
  const expectationMet = profile.features.letClause ? !hasUnsupported : hasUnsupported;

  return {
    id: "semantic-let-feature",
    title: "Semantic validation enforces LET feature support",
    kind: "semantic",
    status: expectationMet ? "passed" : "failed",
    expected: profile.features.letClause ? "LET is accepted for this profile." : "LET is rejected for this profile.",
    observed: hasUnsupported ? "LET produced dialect-unsupported-feature" : "LET did not produce dialect-unsupported-feature",
    evidence: ["src/validate.ts", "test/dialects.test.ts"],
    diagnostics: validation.diagnostics.map((diagnostic) => diagnostic.code)
  };
}

function checkPathModeFeature(profile: DialectProfile): DialectCertificationCheck {
  const validation = validateQuery(pathModeQuery(), schemaForProfile(profile.id), { dialect: profile.id });
  const unsupportedDiagnostics = validation.diagnostics.filter((diagnostic) => diagnostic.code === "dialect-unsupported-feature");
  const expectsSupport = profile.features.pathModes && profile.features.shortestPathModes;
  const expectationMet = expectsSupport ? unsupportedDiagnostics.length === 0 : unsupportedDiagnostics.length > 0;

  return {
    id: "semantic-path-mode-feature",
    title: "Semantic validation enforces path mode and shortest path support",
    kind: "semantic",
    status: expectationMet ? "passed" : "failed",
    expected: expectsSupport
      ? "Path modes and shortest path modifiers are accepted for this profile."
      : "Unsupported path modes or shortest path modifiers are rejected for this profile.",
    observed: `${unsupportedDiagnostics.length} unsupported feature diagnostic(s)`,
    evidence: ["src/validate.ts", "test/dialects.test.ts"],
    diagnostics: validation.diagnostics.map((diagnostic) => diagnostic.code)
  };
}

function checkRelationshipRangeRendering(profile: DialectProfile): DialectCertificationCheck {
  const validation = validateQuery(variableRangeQuery(), schemaForProfile(profile.id), { dialect: profile.id });
  const diagnostics = validation.diagnostics.map((diagnostic) => diagnostic.code);
  const hasRenderingLimitation = diagnostics.includes("dialect-rendering-limitation");
  const expectsLegacyStar = profile.rendering.relationshipRangeStyle === "legacy-star";
  const expectationMet = expectsLegacyStar ? !hasRenderingLimitation : hasRenderingLimitation;
  const status: CertificationStatus = expectationMet && hasRenderingLimitation ? "warning" : expectationMet ? "passed" : "failed";

  return {
    id: "renderer-relationship-range-style",
    title: "Renderer relationship range style is certified or explicitly limited",
    kind: "renderer",
    status,
    expected: expectsLegacyStar
      ? "Legacy star relationship ranges render without dialect warnings."
      : "Non-legacy relationship range preference is surfaced as a known renderer limitation.",
    observed: hasRenderingLimitation ? "dialect-rendering-limitation emitted" : "no rendering limitation emitted",
    evidence: ["src/render.ts", "src/validate.ts", "docs/COMPATIBILITY.md"],
    diagnostics,
    cypher: renderQueryForDialect(variableRangeQuery(), profile.id)
  };
}

function checkLiveDatabaseEvidence(
  profile: DialectProfile,
  liveDatabaseEvidence: DialectLiveDatabaseEvidence[]
): DialectCertificationCheck {
  const cypher = renderQueryForDialect(baseReadQuery(), profile.id);
  const evidence = liveDatabaseEvidence.find((item) => item.profileId === profile.id);
  if (!evidence) {
    return {
      id: "live-database-evidence",
      title: "Live database evidence is reported separately from parser and semantic checks",
      kind: "live-database",
      status: "warning",
      expected: "A live database EXPLAIN or execution fixture is supplied for this dialect profile when available.",
      observed: "No live database evidence supplied; parser, renderer, and semantic certification are still reported.",
      evidence: ["src/neo4j-explain.ts", "docs/NEO4J_LIVE_FIXTURE.md"],
      diagnostics: ["dialect-live-evidence-missing"],
      cypher
    };
  }

  return {
    id: "live-database-evidence",
    title: "Live database evidence is reported separately from parser and semantic checks",
    kind: "live-database",
    status: evidence.status,
    expected: "A live database EXPLAIN or execution fixture is supplied for this dialect profile when available.",
    observed: evidence.observed ?? `${evidence.database} evidence from ${evidence.source}`,
    evidence: ["src/neo4j-explain.ts", evidence.source],
    diagnostics: evidence.diagnostics ?? [],
    cypher: evidence.cypher ?? cypher
  };
}

function schemaForProfile(dialect: DialectProfileId): CypherSchemaContract {
  return {
    version: "cypher-llm-schema/v1",
    dialect,
    nodes: [
      { name: "Tool", properties: { name: { type: "STRING" } } },
      { name: "Hash", properties: { value: { type: "STRING" } } },
      { name: "Tool Hash", properties: { "hash value": { type: "STRING" } } }
    ],
    relationships: [{ type: "HAS_HASH", from: "Tool", to: "Hash" }]
  };
}

function baseReadQuery(): CypherQuery {
  return {
    version: "cypher-llm-ir/v1",
    profile: "llm-safe-readonly",
    clauses: [
      {
        kind: "match",
        patterns: [
          {
            segments: [
              { variable: "tool", labels: ["Tool"] },
              { rel: { types: ["HAS_HASH"], direction: "out" }, node: { variable: "hash", labels: ["Hash"] } }
            ]
          }
        ]
      },
      { kind: "return", items: [{ expression: { kind: "var", name: "hash" } }], limit: { kind: "literal", value: 10 } }
    ]
  };
}

function letQuery(): CypherQuery {
  return {
    version: "cypher-llm-ir/v1",
    clauses: [
      { kind: "let", bindings: [{ alias: "limitValue", expression: { kind: "literal", value: 10 } }] },
      { kind: "return", items: [{ expression: { kind: "var", name: "limitValue" } }], limit: { kind: "literal", value: 1 } }
    ]
  };
}

function pathModeQuery(): CypherQuery {
  return {
    version: "cypher-llm-ir/v1",
    clauses: [
      {
        kind: "match",
        patterns: [
          {
            mode: "trail",
            shortest: "any",
            segments: [
              { variable: "tool", labels: ["Tool"] },
              { rel: { types: ["HAS_HASH"], direction: "out" }, node: { variable: "hash", labels: ["Hash"] } }
            ]
          }
        ]
      },
      { kind: "return", items: [{ expression: { kind: "var", name: "hash" } }], limit: { kind: "literal", value: 1 } }
    ]
  };
}

function variableRangeQuery(): CypherQuery {
  return {
    version: "cypher-llm-ir/v1",
    clauses: [
      {
        kind: "match",
        patterns: [
          {
            segments: [
              { variable: "tool", labels: ["Tool"] },
              {
                rel: { types: ["HAS_HASH"], direction: "out", minHops: 1, maxHops: 3 },
                node: { variable: "hash", labels: ["Hash"] }
              }
            ]
          }
        ]
      },
      { kind: "return", items: [{ expression: { kind: "var", name: "hash" } }], limit: { kind: "literal", value: 1 } }
    ]
  };
}

function aggregateStatus(statuses: CertificationStatus[]): CertificationStatus {
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("warning")) {
    return "warning";
  }
  return "passed";
}
