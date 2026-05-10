import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import { buildCompatibilityCatalog, type CompatibilityCatalog, type CompatibilityContract } from "./compatibility.js";

export type ContractConformanceStatus = "pass" | "warn" | "fail";
export type ContractConformanceCheckId = "schema-file" | "example-file" | "evidence-file" | "fingerprint" | "schema-validation";

export interface ContractConformanceCheck {
  id: ContractConformanceCheckId;
  status: ContractConformanceStatus;
  path: string;
  message: string;
}

export interface ContractConformanceContract {
  id: string;
  version: string;
  level: string;
  status: ContractConformanceStatus;
  checks: ContractConformanceCheck[];
}

export interface ContractConformanceReport {
  version: "cypher-llm-contract-conformance/v1";
  generatedAt: string;
  compatibilityCatalogVersion: "cypher-llm-compatibility-catalog/v1";
  packageName: string;
  packageVersion: string;
  summary: {
    contracts: number;
    passedContracts: number;
    warningContracts: number;
    failedContracts: number;
    checks: number;
    warnings: number;
    failures: number;
    missingFiles: number;
    fingerprintMismatches: number;
    schemaValidationFailures: number;
  };
  contracts: ContractConformanceContract[];
}

interface AjvLike {
  addSchema(schema: unknown): unknown;
  compile(schema: unknown): ((value: unknown) => boolean) & { errors?: Array<{ instancePath?: string; message?: string }> };
  getSchema(schemaId: string): (((value: unknown) => boolean) & { errors?: Array<{ instancePath?: string; message?: string }> }) | undefined;
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT_CANDIDATES = [resolve(MODULE_DIR, "..", ".."), resolve(MODULE_DIR, ".."), process.cwd()];
const SELF_GENERATED_CATALOG_EXAMPLE = "examples/governance/compatibility-catalog.json";

export function buildContractConformanceReport(
  catalog: CompatibilityCatalog = buildCompatibilityCatalog()
): ContractConformanceReport {
  const contracts = catalog.contracts.map((contract) => contractConformance(contract));
  const checks = contracts.flatMap((contract) => contract.checks);
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;

  return {
    version: "cypher-llm-contract-conformance/v1",
    generatedAt: "2026-05-10",
    compatibilityCatalogVersion: catalog.version,
    packageName: catalog.packageName,
    packageVersion: catalog.packageVersion,
    summary: {
      contracts: contracts.length,
      passedContracts: contracts.filter((contract) => contract.status === "pass").length,
      warningContracts: contracts.filter((contract) => contract.status === "warn").length,
      failedContracts: contracts.filter((contract) => contract.status === "fail").length,
      checks: checks.length,
      warnings,
      failures,
      missingFiles: checks.filter((check) => check.status === "fail" && /missing/.test(check.message)).length,
      fingerprintMismatches: checks.filter((check) => check.id === "fingerprint" && check.status === "fail").length,
      schemaValidationFailures: checks.filter((check) => check.id === "schema-validation" && check.status === "fail").length
    },
    contracts
  };
}

export function renderContractConformanceMarkdown(report: ContractConformanceReport): string {
  const lines = [
    "# Contract Conformance",
    "",
    `Package: ${report.packageName}@${report.packageVersion}`,
    `Contracts: ${report.summary.contracts}`,
    `Failures: ${report.summary.failures}`,
    `Warnings: ${report.summary.warnings}`,
    "",
    "## Contracts",
    ""
  ];

  for (const contract of report.contracts) {
    lines.push(`- ${contract.id}: ${contract.status} (${contract.version})`);
    for (const check of contract.checks.filter((item) => item.status !== "pass")) {
      lines.push(`  ${check.status} ${check.id} ${check.path}: ${check.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function contractConformance(contract: CompatibilityContract): ContractConformanceContract {
  const checks = [
    ...schemaChecks(contract),
    ...exampleChecks(contract),
    ...evidenceChecks(contract)
  ];
  const status = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "pass";
  return {
    id: contract.id,
    version: contract.version,
    level: contract.level,
    status,
    checks
  };
}

function schemaChecks(contract: CompatibilityContract): ContractConformanceCheck[] {
  if (!contract.schemaPath) {
    return [];
  }
  return [
    fileExistsCheck("schema-file", contract.schemaPath),
    fingerprintCheck(contract, "schema", contract.schemaPath)
  ];
}

function exampleChecks(contract: CompatibilityContract): ContractConformanceCheck[] {
  return contract.examplePaths.flatMap((examplePath) => {
    const checks = [fileExistsCheck("example-file", examplePath), fingerprintCheck(contract, "example", examplePath)];
    if (contract.schemaPath && existsPackagePath(examplePath) && existsPackagePath(contract.schemaPath)) {
      checks.push(schemaValidationCheck(contract.schemaPath, examplePath));
    }
    return checks;
  });
}

function evidenceChecks(contract: CompatibilityContract): ContractConformanceCheck[] {
  return contract.evidencePaths.map((evidencePath) => fileExistsCheck("evidence-file", evidencePath));
}

function fileExistsCheck(id: ContractConformanceCheckId, relativePath: string): ContractConformanceCheck {
  const exists = existsPackagePath(relativePath);
  return {
    id,
    status: exists ? "pass" : "fail",
    path: relativePath,
    message: exists ? "File exists." : `File is missing: ${relativePath}.`
  };
}

function fingerprintCheck(
  contract: CompatibilityContract,
  kind: "schema" | "example",
  relativePath: string
): ContractConformanceCheck {
  if (relativePath === SELF_GENERATED_CATALOG_EXAMPLE) {
    return {
      id: "fingerprint",
      status: "pass",
      path: relativePath,
      message: "Self-generated compatibility catalog example intentionally skips a self-referential fingerprint."
    };
  }
  const fingerprint = (contract.fingerprints ?? []).find((item) => item.kind === kind && item.path === relativePath);
  if (!fingerprint) {
    return {
      id: "fingerprint",
      status: "fail",
      path: relativePath,
      message: `No ${kind} fingerprint is recorded for ${relativePath}.`
    };
  }
  if (!existsPackagePath(relativePath)) {
    return {
      id: "fingerprint",
      status: "fail",
      path: relativePath,
      message: `Cannot verify fingerprint because file is missing: ${relativePath}.`
    };
  }
  const actual = fingerprintPackagePath(relativePath);
  return {
    id: "fingerprint",
    status: actual === fingerprint.sha256 ? "pass" : "fail",
    path: relativePath,
    message: actual === fingerprint.sha256 ? "Fingerprint matches." : `Fingerprint mismatch for ${relativePath}.`
  };
}

function schemaValidationCheck(schemaPath: string, examplePath: string): ContractConformanceCheck {
  try {
    const schema = readJson(schemaPath) as { $id?: string };
    const example = readJson(examplePath);
    const ajv = ajvWithPackageSchemas();
    const validate = schema.$id ? ajv.getSchema(schema.$id) ?? ajv.compile(schema) : ajv.compile(schema);
    const valid = validate(example);
    return {
      id: "schema-validation",
      status: valid ? "pass" : "fail",
      path: examplePath,
      message: valid ? "Example validates against schema." : schemaValidationMessage(validate.errors)
    };
  } catch (error) {
    return {
      id: "schema-validation",
      status: "fail",
      path: examplePath,
      message: error instanceof Error ? error.message : "Schema validation failed."
    };
  }
}

function schemaValidationMessage(errors: Array<{ instancePath?: string; message?: string }> | undefined): string {
  const first = errors?.[0];
  if (!first) {
    return "Example does not validate against schema.";
  }
  return `Example does not validate at ${first.instancePath || "/"}: ${first.message ?? "schema violation"}.`;
}

function readJson(relativePath: string): unknown {
  return JSON.parse(readPackageFile(relativePath).toString("utf8")) as unknown;
}

function ajvWithPackageSchemas(): AjvLike {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schemaDir = packagePath("schemas");
  for (const file of readdirSync(schemaDir)) {
    if (file.endsWith(".schema.json")) {
      ajv.addSchema(readJson(`schemas/${file}`));
    }
  }
  return ajv;
}

function fingerprintPackagePath(relativePath: string): string {
  return createHash("sha256").update(readPackageFile(relativePath)).digest("hex");
}

function existsPackagePath(relativePath: string): boolean {
  return PACKAGE_ROOT_CANDIDATES.some((root) => existsSync(resolve(root, relativePath)));
}

function readPackageFile(relativePath: string): Buffer {
  return readFileSync(packagePath(relativePath));
}

function packagePath(relativePath: string): string {
  for (const root of PACKAGE_ROOT_CANDIDATES) {
    const absolutePath = resolve(root, relativePath);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  throw new Error(`Unable to read package path: ${relativePath}`);
}
