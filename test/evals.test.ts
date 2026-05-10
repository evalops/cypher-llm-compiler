import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import type { EvalAttemptSet, EvalDataset } from "../src/evals.js";
import { evaluateAttempts } from "../src/evals.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("eval harness", () => {
  it("scores IR and raw Cypher attempts against task expectations", () => {
    const dataset = readJson<EvalDataset>("examples/eval-dataset.json");
    const attempts = readJson<EvalAttemptSet>("examples/eval-attempts.json");
    const report = evaluateAttempts(dataset, attempts, { defaultLimit: 25, defaultMaxHops: 5 });

    assert.equal(report.metrics.totalTasks, 3);
    assert.equal(report.metrics.passedTasks, 3);
    assert.equal(report.metrics.passRate, 1);
    assert.equal(report.metrics.irAttempts, 2);
    assert.equal(report.metrics.rawAttempts, 1);
    assert.equal(report.results[0]?.cypher?.includes("[:`has MD5 hash`]->"), true);
    assert.equal(report.results[1]?.diagnostics.includes("undefined-variable"), true);
    assert.equal(report.results[2]?.repairs.includes("quote-raw-identifier"), true);
  });

  it("keeps checked-in imported reports reproducible", () => {
    const importedDir = path.join(process.cwd(), "examples/imported");
    const datasetFiles = readdirSync(importedDir).filter((file) => file.endsWith(".dataset.json"));

    assert.equal(datasetFiles.length >= 3, true);
    for (const datasetFile of datasetFiles) {
      const prefix = datasetFile.replace(/\.dataset\.json$/, "");
      const dataset = readJson<EvalDataset>(`examples/imported/${prefix}.dataset.json`);
      const attempts = readJson<EvalAttemptSet>(`examples/imported/${prefix}.attempts.json`);
      const report = readJson<{ metrics: { totalTasks: number; passedTasks: number } }>(
        `examples/imported/${prefix}.report.json`
      );
      const regenerated = evaluateAttempts(dataset, attempts, {
        rawCypherCanExecute: prefix !== "text2cypher-gpt4o-sample"
      });

      assert.equal(regenerated.metrics.totalTasks, report.metrics.totalTasks, prefix);
      assert.equal(regenerated.metrics.passedTasks, report.metrics.passedTasks, prefix);
    }
  });
});

describe("json schemas", () => {
  it("validate the checked-in examples used by the CLI and eval runner", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schemaContractSchema = readJson("schemas/cypher-schema-contract.schema.json");
    const querySchema = readJson("schemas/cypher-query.schema.json");
    const proofSchema = readJson("schemas/cypher-proof.schema.json");
    const policyReportSchema = readJson("schemas/policy-report.schema.json");
    const dialectProfileSchema = readJson("schemas/dialect-profile.schema.json");
    const dialectCertificationSchema = readJson("schemas/dialect-certification.schema.json");
    const yearsRoadmapSchema = readJson("schemas/years-roadmap.schema.json");
    const evalDatasetSchema = readJson("schemas/eval-dataset.schema.json");
    const evalAttemptsSchema = readJson("schemas/eval-attempts.schema.json");
    ajv.addSchema(schemaContractSchema);
    ajv.addSchema(querySchema);
    ajv.addSchema(proofSchema);
    ajv.addSchema(policyReportSchema);
    ajv.addSchema(dialectProfileSchema);
    ajv.addSchema(dialectCertificationSchema);
    ajv.addSchema(yearsRoadmapSchema);
    ajv.addSchema(evalDatasetSchema);
    ajv.addSchema(evalAttemptsSchema);

    assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/schema-contract/v1.json", readJson("examples/tool-hash.schema.json"));
    assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/query/v1.json", readJson("examples/tool-hash.query.json"));
    assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/proof/v1.json", readJson("examples/proofs/tool-hash.proof.json"));
    assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/policy-report/v1.json", readJson("examples/policy/tool-hash.policy.json"));
    assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/eval-dataset/v1.json", readJson("examples/eval-dataset.json"));
    assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/eval-attempts/v1.json", readJson("examples/eval-attempts.json"));
    assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/dialect-profile/v1.json", readJson("profiles/neo4j-cypher-25.json"));
    assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/dialect-certification/v1.json", readJson("examples/certification/dialect-certification.json"));
    assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/years-roadmap/v1.json", readJson("examples/roadmap/cypher-llm-years-roadmap.json"));

    const importedDir = path.join(process.cwd(), "examples/imported");
    for (const file of readdirSync(importedDir)) {
      if (file.endsWith(".dataset.json")) {
        assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/eval-dataset/v1.json", readJson(`examples/imported/${file}`));
      }
      if (file.endsWith(".attempts.json")) {
        assertValid(ajv, "https://evalops.dev/schemas/cypher-llm/eval-attempts/v1.json", readJson(`examples/imported/${file}`));
      }
    }
  });
});

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}

function assertValid(ajv: AjvLike, schemaId: string, value: unknown) {
  const validate = ajv.getSchema(schemaId);
  assert.ok(validate, `missing schema ${schemaId}`);
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
}
