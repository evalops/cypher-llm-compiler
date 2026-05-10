import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import { buildCompatibilityCatalog } from "../src/compatibility.js";
import {
  buildContractConformanceReport,
  renderContractConformanceMarkdown,
  type ContractConformanceReport
} from "../src/contract-conformance.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("contract conformance", () => {
  it("checks schema files, examples, fingerprints, schema validation, and evidence paths", () => {
    const report = buildContractConformanceReport();

    assert.equal(report.version, "cypher-llm-contract-conformance/v1");
    assert.equal(report.summary.failedContracts, 0);
    assert.equal(report.summary.failures, 0);
    assert.ok(report.contracts.some((contract) => contract.id === "compatibility-catalog" && contract.status === "pass"));
    assert.ok(report.contracts.some((contract) => contract.id === "contract-conformance" && contract.status === "pass"));
    assert.ok(report.summary.checks > report.summary.contracts);
  });

  it("renders a markdown conformance view", () => {
    const markdown = renderContractConformanceMarkdown(buildContractConformanceReport());

    assert.ok(markdown.includes("# Contract Conformance"));
    assert.ok(markdown.includes("Failures: 0"));
  });

  it("reports fingerprint mismatches as failures", () => {
    const catalog = buildCompatibilityCatalog();
    const contract = catalog.contracts.find((candidate) => candidate.id === "cypher-query-ir");
    assert.ok(contract?.fingerprints?.[0]);
    contract.fingerprints = contract.fingerprints.map((fingerprint, index) =>
      index === 0 ? { ...fingerprint, sha256: "0".repeat(64) } : fingerprint
    );

    const report = buildContractConformanceReport(catalog);

    assert.equal(report.summary.failedContracts, 1);
    assert.equal(report.summary.fingerprintMismatches, 1);
    assert.ok(report.contracts.some((candidate) => candidate.id === "cypher-query-ir" && candidate.status === "fail"));
  });

  it("keeps checked-in conformance JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = readJson("schemas/contract-conformance.schema.json");
    const checkedIn = readJson<ContractConformanceReport>("examples/governance/contract-conformance.json");
    ajv.addSchema(schema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/contract-conformance/v1.json");

    assert.ok(validate, "missing contract conformance schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(checkedIn, buildContractConformanceReport());
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
