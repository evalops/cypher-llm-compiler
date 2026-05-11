import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import type { EvalAttemptSet, EvalDataset } from "../src/evals.js";
import { evaluatePolicyAttempts, type CypherPolicyEvalReport } from "../src/policy-eval.js";
import { getPolicyProfile, policyOptionsFromProfile } from "../src/policy-profile.js";
import type { CypherPolicyRuleSet } from "../src/policy-rules.js";
import type { CypherSchemaStatistics } from "../src/schema-statistics.js";

interface AjvLike {
  addSchema(schema: unknown): unknown;
  getSchema(schemaId: string): ((value: unknown) => boolean) & { errors?: unknown };
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Record<string, unknown>) => AjvLike;

describe("policy eval", () => {
  it("benchmarks risky but executable attempts across a dataset", () => {
    const report = buildFixturePolicyEvalReport();

    assert.equal(report.version, "cypher-llm-policy-eval/v1");
    assert.equal(report.summary.totalTasks, 3);
    assert.equal(report.summary.evaluatedAttempts, 3);
    assert.equal(report.summary.blockedAttempts, 3);
    assert.equal(report.summary.riskyExecutableAttempts, 2);
    assert.equal(report.summary.findingsByCode["policy-sensitive-property-return"], 1);
    assert.equal(report.results.find((result) => result.taskId === "tool-md5-by-name")?.compilerCanExecute, true);
    assert.equal(report.results.find((result) => result.taskId === "tool-scope-drift")?.compilerCanExecute, false);
    assert.equal(report.results.find((result) => result.taskId === "raw-spaced-relationship")?.kind, "raw");
  });

  it("keeps terminal attempts visible as not evaluated", () => {
    const dataset = readJson<EvalDataset>("examples/eval-dataset.json");
    const attempts: EvalAttemptSet = {
      version: "cypher-llm-eval-attempts/v1",
      datasetName: dataset.name,
      attempts: [{ taskId: "tool-md5-by-name", noCypher: true }]
    };
    const report = evaluatePolicyAttempts(dataset, attempts);

    assert.equal(report.summary.evaluatedAttempts, 0);
    assert.equal(report.summary.noCypherAttempts, 1);
    assert.equal(report.summary.missingAttempts, 2);
    assert.equal(report.results[0]?.status, "not-evaluated");
    assert.deepEqual(report.results[0]?.diagnostics, ["no-cypher-output"]);
  });

  it("keeps checked-in policy eval JSON aligned with runtime data and schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const policyEvalSchema = readJson("schemas/policy-eval.schema.json");
    const checkedIn = readJson<CypherPolicyEvalReport>("examples/policy/tool-hash.policy-eval.json");
    ajv.addSchema(policyEvalSchema);
    const validate = ajv.getSchema("https://evalops.dev/schemas/cypher-llm/policy-eval/v1.json");

    assert.ok(validate, "missing policy eval schema");
    assert.equal(validate(checkedIn), true, JSON.stringify(validate.errors, null, 2));
    assert.deepEqual(checkedIn, buildFixturePolicyEvalReport());
  });
});

function buildFixturePolicyEvalReport(): CypherPolicyEvalReport {
  const options = policyOptionsFromProfile(getPolicyProfile("llm-readonly-strict"), {
    policyRules: readJson<CypherPolicyRuleSet>("examples/policy/tool-hash.policy-rules.json"),
    schemaStatistics: readJson<CypherSchemaStatistics>("examples/policy/tool-hash.schema-statistics.json")
  });
  return evaluatePolicyAttempts(
    readJson<EvalDataset>("examples/eval-dataset.json"),
    readJson<EvalAttemptSet>("examples/eval-attempts.json"),
    {
      ...options,
      defaultLimit: 25,
      defaultMaxHops: 3
    }
  );
}

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as T;
}
