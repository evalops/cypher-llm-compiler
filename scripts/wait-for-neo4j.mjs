#!/usr/bin/env node
import neo4j from "neo4j-driver";

const uri = process.env.CYPHER_LLM_NEO4J_URI ?? "bolt://localhost:7687";
const user = process.env.CYPHER_LLM_NEO4J_USER ?? "neo4j";
const password = process.env.CYPHER_LLM_NEO4J_PASSWORD;
const timeoutMs = Number(process.env.CYPHER_LLM_NEO4J_WAIT_MS ?? 120000);

if (!password) {
  console.error("Missing CYPHER_LLM_NEO4J_PASSWORD.");
  process.exit(2);
}

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
const deadline = Date.now() + timeoutMs;
let lastError;

while (Date.now() < deadline) {
  try {
    await driver.verifyConnectivity();
    await driver.close();
    console.log(`Neo4j is reachable at ${uri}.`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    await sleep(2000);
  }
}

await driver.close();
console.error(`Timed out waiting for Neo4j at ${uri}.`);
if (lastError) {
  console.error(lastError instanceof Error ? lastError.message : String(lastError));
}
process.exit(1);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
