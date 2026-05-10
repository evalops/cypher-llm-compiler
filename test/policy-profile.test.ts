import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildPolicyProfileCatalog, getPolicyProfile, policyOptionsFromProfile } from "../src/policy-profile.js";

describe("policy profiles", () => {
  it("lists built-in policy profiles with stable ids", () => {
    const catalog = buildPolicyProfileCatalog();

    assert.equal(catalog.version, "cypher-llm-policy-profile-catalog/v1");
    assert.deepEqual(
      catalog.profiles.map((profile) => profile.id),
      ["llm-readonly-strict", "llm-readonly-exploration", "approved-write-maintenance"]
    );
  });

  it("turns profiles into policy options with report attribution", () => {
    const options = policyOptionsFromProfile(getPolicyProfile("llm-readonly-exploration"), { maxReturnLimit: 250 });

    assert.equal(options.allowWrites, false);
    assert.equal(options.requireLimit, true);
    assert.equal(options.maxReturnLimit, 250);
    assert.equal(options.maxRelationshipHops, 8);
    assert.deepEqual(options.profile, { id: "llm-readonly-exploration", title: "LLM Readonly Exploration" });
  });

  it("keeps checked-in policy profile catalog aligned with runtime data", () => {
    const expected = JSON.parse(readFileSync(path.join(process.cwd(), "examples/policy/policy-profiles.json"), "utf8")) as unknown;

    assert.deepEqual(buildPolicyProfileCatalog(), expected);
  });
});
