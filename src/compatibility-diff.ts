import {
  buildCompatibilityCatalog,
  type CompatibilityCatalog,
  type CompatibilityContract,
  type CompatibilityContractFingerprint,
  type CompatibilityGate,
  type CompatibilityLevel
} from "./compatibility.js";

export type CompatibilityDiffStatus = "passed" | "failed";
export type CompatibilityDiffSeverity = "info" | "warning" | "breaking";
export type CompatibilityDiffKind = "added" | "removed" | "changed";
export type CompatibilityDiffTarget =
  | "contract"
  | "contract-fingerprint"
  | "release-gate"
  | "certification-gate"
  | "deprecation-policy";

export interface CompatibilityDiffChange {
  kind: CompatibilityDiffKind;
  severity: CompatibilityDiffSeverity;
  target: CompatibilityDiffTarget;
  id: string;
  field?: string;
  baselineValue?: string;
  candidateValue?: string;
  message: string;
}

export interface CompatibilityCatalogSummary {
  version: string;
  packageName: string;
  packageVersion: string;
  contracts: number;
  stableContracts: number;
  previewContracts: number;
  experimentalContracts: number;
}

export interface CompatibilityDiffReport {
  version: "cypher-llm-compatibility-diff/v1";
  status: CompatibilityDiffStatus;
  baseline: CompatibilityCatalogSummary;
  candidate: CompatibilityCatalogSummary;
  changes: CompatibilityDiffChange[];
  summary: {
    changes: number;
    added: number;
    removed: number;
    changed: number;
    breaking: number;
    warnings: number;
    info: number;
  };
}

export function buildCompatibilityDiffReport(
  baseline: CompatibilityCatalog,
  candidate: CompatibilityCatalog = buildCompatibilityCatalog()
): CompatibilityDiffReport {
  const changes: CompatibilityDiffChange[] = [];
  diffContracts(baseline.contracts, candidate.contracts, changes);
  diffGates("release-gate", baseline.releaseGates, candidate.releaseGates, changes);
  diffGates("certification-gate", baseline.certificationGates, candidate.certificationGates, changes);
  diffDeprecationPolicy(baseline, candidate, changes);

  const summary = {
    changes: changes.length,
    added: changes.filter((change) => change.kind === "added").length,
    removed: changes.filter((change) => change.kind === "removed").length,
    changed: changes.filter((change) => change.kind === "changed").length,
    breaking: changes.filter((change) => change.severity === "breaking").length,
    warnings: changes.filter((change) => change.severity === "warning").length,
    info: changes.filter((change) => change.severity === "info").length
  };

  return {
    version: "cypher-llm-compatibility-diff/v1",
    status: summary.breaking === 0 ? "passed" : "failed",
    baseline: summarizeCatalog(baseline),
    candidate: summarizeCatalog(candidate),
    changes,
    summary
  };
}

export function renderCompatibilityDiffMarkdown(report: CompatibilityDiffReport): string {
  const lines = [
    "# Compatibility Diff",
    "",
    `Status: ${report.status}`,
    `Baseline: ${report.baseline.packageName}@${report.baseline.packageVersion} (${report.baseline.contracts} contracts)`,
    `Candidate: ${report.candidate.packageName}@${report.candidate.packageVersion} (${report.candidate.contracts} contracts)`,
    "",
    "## Summary",
    "",
    `- Breaking: ${report.summary.breaking}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Info: ${report.summary.info}`,
    "",
    "## Changes",
    ""
  ];

  if (report.changes.length === 0) {
    lines.push("- No compatibility changes detected.");
  } else {
    for (const change of report.changes) {
      const field = change.field ? ` ${change.field}` : "";
      lines.push(`- ${change.severity} ${change.target} ${change.id}${field}: ${change.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function diffContracts(
  baselineContracts: readonly CompatibilityContract[],
  candidateContracts: readonly CompatibilityContract[],
  changes: CompatibilityDiffChange[]
) {
  const baselineById = new Map(baselineContracts.map((contract) => [contract.id, contract]));
  const candidateById = new Map(candidateContracts.map((contract) => [contract.id, contract]));

  for (const baseline of baselineContracts) {
    const candidate = candidateById.get(baseline.id);
    if (!candidate) {
      changes.push({
        kind: "removed",
        severity: removalSeverity(baseline.level),
        target: "contract",
        id: baseline.id,
        baselineValue: baseline.version,
        message: `Removed ${baseline.level} contract ${baseline.version}.`
      });
      continue;
    }

    compareContractField("version", baseline, candidate, versionChangeSeverity(baseline.level), changes);
    if (baseline.level !== candidate.level) {
      const severity = levelRank(candidate.level) < levelRank(baseline.level) ? removalSeverity(baseline.level) : "info";
      changes.push({
        kind: "changed",
        severity,
        target: "contract",
        id: baseline.id,
        field: "level",
        baselineValue: baseline.level,
        candidateValue: candidate.level,
        message: `Compatibility level changed from ${baseline.level} to ${candidate.level}.`
      });
    }
    compareContractField("category", baseline, candidate, "warning", changes);
    compareContractField("ownerWorkstreamId", baseline, candidate, "warning", changes);
    compareContractField("schemaPath", baseline, candidate, versionChangeSeverity(baseline.level), changes);
    compareContractField("breakingChangePolicy", baseline, candidate, "warning", changes);
    compareContractField("deprecationPolicy", baseline, candidate, "warning", changes);
    for (const removedExample of removedItems(baseline.examplePaths, candidate.examplePaths)) {
      changes.push({
        kind: "changed",
        severity: "warning",
        target: "contract",
        id: baseline.id,
        field: "examplePaths",
        baselineValue: removedExample,
        message: `Example path was removed from the contract evidence: ${removedExample}.`
      });
    }
    for (const removedEvidence of removedItems(baseline.evidencePaths, candidate.evidencePaths)) {
      changes.push({
        kind: "changed",
        severity: "warning",
        target: "contract",
        id: baseline.id,
        field: "evidencePaths",
        baselineValue: removedEvidence,
        message: `Evidence path was removed from the contract: ${removedEvidence}.`
      });
    }
    diffContractFingerprints(baseline, candidate, changes);
  }

  for (const candidate of candidateContracts) {
    if (!baselineById.has(candidate.id)) {
      changes.push({
        kind: "added",
        severity: "info",
        target: "contract",
        id: candidate.id,
        candidateValue: candidate.version,
        message: `Added ${candidate.level} contract ${candidate.version}.`
      });
    }
  }
}

function diffContractFingerprints(
  baseline: CompatibilityContract,
  candidate: CompatibilityContract,
  changes: CompatibilityDiffChange[]
) {
  const baselineFingerprints = fingerprintMap(baseline.fingerprints ?? []);
  const candidateFingerprints = fingerprintMap(candidate.fingerprints ?? []);

  for (const [key, baselineFingerprint] of baselineFingerprints) {
    const candidateFingerprint = candidateFingerprints.get(key);
    if (!candidateFingerprint) {
      changes.push({
        kind: "removed",
        severity: removalSeverity(baseline.level),
        target: "contract-fingerprint",
        id: baseline.id,
        field: key,
        baselineValue: baselineFingerprint.sha256,
        message: `Removed ${baselineFingerprint.kind} fingerprint for ${baselineFingerprint.path}.`
      });
      continue;
    }
    if (baselineFingerprint.sha256 !== candidateFingerprint.sha256) {
      changes.push({
        kind: "changed",
        severity: versionChangeSeverity(baseline.level),
        target: "contract-fingerprint",
        id: baseline.id,
        field: key,
        baselineValue: baselineFingerprint.sha256,
        candidateValue: candidateFingerprint.sha256,
        message: `${baselineFingerprint.kind} fingerprint changed for ${baselineFingerprint.path}.`
      });
    }
  }

  for (const [key, candidateFingerprint] of candidateFingerprints) {
    if (!baselineFingerprints.has(key)) {
      changes.push({
        kind: "added",
        severity: "info",
        target: "contract-fingerprint",
        id: candidate.id,
        field: key,
        candidateValue: candidateFingerprint.sha256,
        message: `Added ${candidateFingerprint.kind} fingerprint for ${candidateFingerprint.path}.`
      });
    }
  }
}

function diffGates(
  target: "release-gate" | "certification-gate",
  baselineGates: readonly CompatibilityGate[],
  candidateGates: readonly CompatibilityGate[],
  changes: CompatibilityDiffChange[]
) {
  const baselineById = new Map(baselineGates.map((gate) => [gate.id, gate]));
  const candidateById = new Map(candidateGates.map((gate) => [gate.id, gate]));

  for (const baseline of baselineGates) {
    const candidate = candidateById.get(baseline.id);
    if (!candidate) {
      changes.push({
        kind: "removed",
        severity: "breaking",
        target,
        id: baseline.id,
        baselineValue: baseline.command,
        message: `Removed required ${target} command.`
      });
      continue;
    }
    if (baseline.command !== candidate.command) {
      changes.push({
        kind: "changed",
        severity: "warning",
        target,
        id: baseline.id,
        field: "command",
        baselineValue: baseline.command,
        candidateValue: candidate.command,
        message: "Gate command changed; release automation should review the new command."
      });
    }
  }

  for (const candidate of candidateGates) {
    if (!baselineById.has(candidate.id)) {
      changes.push({
        kind: "added",
        severity: "info",
        target,
        id: candidate.id,
        candidateValue: candidate.command,
        message: `Added ${target} command.`
      });
    }
  }
}

function diffDeprecationPolicy(
  baseline: CompatibilityCatalog,
  candidate: CompatibilityCatalog,
  changes: CompatibilityDiffChange[]
) {
  if (baseline.deprecationPolicy.minimumNotice !== candidate.deprecationPolicy.minimumNotice) {
    changes.push({
      kind: "changed",
      severity: "warning",
      target: "deprecation-policy",
      id: "minimumNotice",
      baselineValue: baseline.deprecationPolicy.minimumNotice,
      candidateValue: candidate.deprecationPolicy.minimumNotice,
      message: "Deprecation notice window changed."
    });
  }

  compareBooleanPolicy("requiresMigrationNote", baseline, candidate, changes);
  compareBooleanPolicy("requiresReplacementContract", baseline, candidate, changes);

  for (const removedLevel of removedItems(baseline.deprecationPolicy.appliesToLevels, candidate.deprecationPolicy.appliesToLevels)) {
    changes.push({
      kind: "changed",
      severity: "breaking",
      target: "deprecation-policy",
      id: "appliesToLevels",
      baselineValue: removedLevel,
      message: `Deprecation policy no longer applies to ${removedLevel} contracts.`
    });
  }
}

function compareContractField(
  field: keyof Pick<CompatibilityContract, "version" | "category" | "ownerWorkstreamId" | "schemaPath" | "breakingChangePolicy" | "deprecationPolicy">,
  baseline: CompatibilityContract,
  candidate: CompatibilityContract,
  severity: CompatibilityDiffSeverity,
  changes: CompatibilityDiffChange[]
) {
  const baselineValue = baseline[field];
  const candidateValue = candidate[field];
  if (baselineValue === candidateValue) {
    return;
  }
  changes.push({
    kind: "changed",
    severity,
    target: "contract",
    id: baseline.id,
    field,
    ...(baselineValue !== undefined ? { baselineValue } : {}),
    ...(candidateValue !== undefined ? { candidateValue } : {}),
    message: `Contract ${field} changed.`
  });
}

function compareBooleanPolicy(
  field: "requiresMigrationNote" | "requiresReplacementContract",
  baseline: CompatibilityCatalog,
  candidate: CompatibilityCatalog,
  changes: CompatibilityDiffChange[]
) {
  const baselineValue = baseline.deprecationPolicy[field];
  const candidateValue = candidate.deprecationPolicy[field];
  if (baselineValue === candidateValue) {
    return;
  }
  changes.push({
    kind: "changed",
    severity: baselineValue && !candidateValue ? "breaking" : "info",
    target: "deprecation-policy",
    id: field,
    baselineValue: String(baselineValue),
    candidateValue: String(candidateValue),
    message: `Deprecation policy ${field} changed.`
  });
}

function summarizeCatalog(catalog: CompatibilityCatalog): CompatibilityCatalogSummary {
  return {
    version: catalog.version,
    packageName: catalog.packageName,
    packageVersion: catalog.packageVersion,
    contracts: catalog.contracts.length,
    stableContracts: catalog.contracts.filter((contract) => contract.level === "stable").length,
    previewContracts: catalog.contracts.filter((contract) => contract.level === "preview").length,
    experimentalContracts: catalog.contracts.filter((contract) => contract.level === "experimental").length
  };
}

function removedItems<T extends string>(baseline: readonly T[], candidate: readonly T[]): T[] {
  const candidateSet = new Set(candidate);
  return baseline.filter((item) => !candidateSet.has(item));
}

function fingerprintMap(fingerprints: readonly CompatibilityContractFingerprint[]): Map<string, CompatibilityContractFingerprint> {
  return new Map(fingerprints.map((fingerprint) => [`${fingerprint.kind}:${fingerprint.path}`, fingerprint]));
}

function levelRank(level: CompatibilityLevel): number {
  switch (level) {
    case "stable":
      return 3;
    case "preview":
      return 2;
    case "experimental":
      return 1;
  }
}

function removalSeverity(level: CompatibilityLevel): CompatibilityDiffSeverity {
  return level === "experimental" ? "warning" : "breaking";
}

function versionChangeSeverity(level: CompatibilityLevel): CompatibilityDiffSeverity {
  return level === "experimental" ? "warning" : "breaking";
}
