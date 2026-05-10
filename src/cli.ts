#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import { certifyDialectProfiles, renderDialectCertificationMarkdown } from "./dialect-certification.js";
import type { EvalAttemptSet, EvalDataset, EvalReport } from "./evals.js";
import { compareEvalReports } from "./eval-compare.js";
import { evaluateAttempts } from "./evals.js";
import { evaluateFailureCorpus } from "./failure-corpus.js";
import {
  importFunctionalCypherJson,
  importOpenCypherTckFeature,
  importText2CypherCsv,
  type ImportOptions,
  type ImportedFixtureSet
} from "./fixture-importers.js";
import { introspectNeo4jSchema } from "./neo4j-introspect.js";
import { buildLspDiagnostics } from "./lsp.js";
import { repairQuery, repairRawCypher } from "./repair.js";
import { evaluateRepairLoop } from "./repair-loop.js";
import { renderQuery } from "./render.js";
import { createSafeExecutionPlan } from "./safety.js";
import { validateCypherTextWithParser } from "./parser-validation.js";
import { assessCypherPolicy } from "./policy.js";
import { buildCypherProof } from "./proof.js";
import { evaluateRawLiftAttempts, liftRawCypherToIr } from "./raw-lift.js";
import { normalizeSchema } from "./schema.js";
import { validateQuery } from "./validate.js";
import { getYearsRoadmap, renderYearsRoadmapMarkdown, roadmapIntegrityReport } from "./years-roadmap.js";

export interface CliIO {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<void>;
  mkdir?: (path: string, options: { recursive: boolean }) => Promise<unknown>;
}

export async function runCli(argv: string[], io: CliIO = defaultIo()): Promise<number> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  try {
    switch (command) {
      case "render":
        await renderCommand(args, io);
        return 0;
      case "validate":
        await validateCommand(args, io);
        return 0;
      case "repair-raw":
        await repairRawCommand(args, io);
        return 0;
      case "lift-raw":
        await liftRawCommand(args, io);
        return 0;
      case "corpus":
        writeJson(io, { results: evaluateFailureCorpus() });
        return 0;
      case "eval":
        await evalCommand(args, io);
        return 0;
      case "compare-evals":
        await compareEvalsCommand(args, io);
        return 0;
      case "repair-loop":
        await repairLoopCommand(args, io);
        return 0;
      case "lift-raw-eval":
        await liftRawEvalCommand(args, io);
        return 0;
      case "parse-check":
        await parseCheckCommand(args, io);
        return 0;
      case "policy-check":
        await policyCheckCommand(args, io);
        return 0;
      case "lsp-diagnostics":
        await lspDiagnosticsCommand(args, io);
        return 0;
      case "prove":
        await proveCommand(args, io);
        return 0;
      case "introspect-neo4j":
        await introspectNeo4jCommand(args, io);
        return 0;
      case "roadmap":
        await roadmapCommand(args, io);
        return 0;
      case "certify-dialects":
        await certifyDialectsCommand(args, io);
        return 0;
      case "mcp":
        await mcpCommand();
        return 0;
      case "serve":
        await serveCommand(args, io);
        return 0;
      case "import-text2cypher":
        await importText2CypherCommand(args, io);
        return 0;
      case "import-functional-cypher":
        await importFunctionalCypherCommand(args, io);
        return 0;
      case "import-opencypher-tck":
        await importOpenCypherTckCommand(args, io);
        return 0;
      case "help":
      case undefined:
        io.stdout.write(usage());
        return 0;
      default:
        io.stderr.write(`Unknown command: ${command}\n\n${usage()}`);
        return 2;
    }
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function renderCommand(args: Map<string, string | boolean>, io: CliIO) {
  const schema = await readSchema(args, io);
  const query = await readQuery(args, io);
  const params = await readParams(args, io);
  const defaultLimit = optionalNumber(args.get("default-limit"));
  const defaultMaxHops = optionalNumber(args.get("default-max-hops"));
  const planOptions: { defaultLimit?: number; defaultMaxHops?: number } = {};
  if (defaultLimit !== undefined) {
    planOptions.defaultLimit = defaultLimit;
  }
  if (defaultMaxHops !== undefined) {
    planOptions.defaultMaxHops = defaultMaxHops;
  }
  const plan = createSafeExecutionPlan(query, schema, params, planOptions);
  writeJson(io, plan);
}

async function validateCommand(args: Map<string, string | boolean>, io: CliIO) {
  const schema = normalizeSchema(await readSchema(args, io));
  const query = await readQuery(args, io);
  writeJson(io, validateQuery(query, schema));
}

async function repairRawCommand(args: Map<string, string | boolean>, io: CliIO) {
  const schema = normalizeSchema(await readSchema(args, io));
  const raw = stringArg(args, "cypher");
  writeJson(io, repairRawCypher(raw, schema));
}

async function liftRawCommand(args: Map<string, string | boolean>, io: CliIO) {
  const schemaPath = args.get("schema");
  const schema = typeof schemaPath === "string" ? await readSchema(args, io) : undefined;
  const raw = stringArg(args, "cypher");
  const result = liftRawCypherToIr(raw, schema, {
    profile: args.get("profile") === "llm-safe-readonly" ? "llm-safe-readonly" : "raw-compatible",
    parserMode: args.get("mode") === "lint" ? "lint" : "syntax"
  });
  if (typeof args.get("query-out") === "string") {
    await writeJsonFile(io, args.get("query-out") as string, result.query);
  }
  if (typeof args.get("summary-out") === "string") {
    await writeJsonFile(io, args.get("summary-out") as string, result);
  }
  writeJson(io, result);
}

async function evalCommand(args: Map<string, string | boolean>, io: CliIO) {
  const dataset = JSON.parse(await io.readFile(stringArg(args, "dataset"), "utf8")) as EvalDataset;
  const attempts = JSON.parse(await io.readFile(stringArg(args, "attempts"), "utf8")) as EvalAttemptSet;
  const defaultLimit = optionalNumber(args.get("default-limit"));
  const defaultMaxHops = optionalNumber(args.get("default-max-hops"));
  const evalOptions: { defaultLimit?: number; defaultMaxHops?: number; rawCypherCanExecute?: boolean } = {};
  if (defaultLimit !== undefined) {
    evalOptions.defaultLimit = defaultLimit;
  }
  if (defaultMaxHops !== undefined) {
    evalOptions.defaultMaxHops = defaultMaxHops;
  }
  if (args.get("raw-cypher-can-execute") === true) {
    evalOptions.rawCypherCanExecute = true;
  }
  const report = evaluateAttempts(dataset, attempts, evalOptions);
  if (typeof args.get("report-out") === "string") {
    await writeJsonFile(io, args.get("report-out") as string, report);
  }
  writeJson(io, report);
}

async function compareEvalsCommand(args: Map<string, string | boolean>, io: CliIO) {
  const baseline = JSON.parse(await io.readFile(stringArg(args, "baseline"), "utf8")) as EvalReport;
  const candidate = JSON.parse(await io.readFile(stringArg(args, "candidate"), "utf8")) as EvalReport;
  const tolerance = optionalNumber(args.get("tolerance"));
  const comparison = compareEvalReports(baseline, candidate, tolerance !== undefined ? { tolerance } : {});
  if (typeof args.get("comparison-out") === "string") {
    await writeJsonFile(io, args.get("comparison-out") as string, comparison);
  }
  writeJson(io, comparison);
  if (args.get("fail-on-regression") === true && comparison.regressions.length > 0) {
    throw new Error(`Eval comparison found ${comparison.regressions.length} regression(s).`);
  }
}

async function repairLoopCommand(args: Map<string, string | boolean>, io: CliIO) {
  const dataset = JSON.parse(await io.readFile(stringArg(args, "dataset"), "utf8")) as EvalDataset;
  const attempts = JSON.parse(await io.readFile(stringArg(args, "attempts"), "utf8")) as EvalAttemptSet;
  const defaultLimit = optionalNumber(args.get("default-limit"));
  const defaultMaxHops = optionalNumber(args.get("default-max-hops"));
  const evalOptions: { defaultLimit?: number; defaultMaxHops?: number; rawCypherCanExecute?: boolean } = {};
  if (defaultLimit !== undefined) {
    evalOptions.defaultLimit = defaultLimit;
  }
  if (defaultMaxHops !== undefined) {
    evalOptions.defaultMaxHops = defaultMaxHops;
  }
  if (args.get("raw-cypher-can-execute") === true) {
    evalOptions.rawCypherCanExecute = true;
  }
  const report = evaluateRepairLoop(dataset, attempts, evalOptions);
  if (typeof args.get("feedback-out") === "string") {
    await writeJsonFile(io, args.get("feedback-out") as string, report);
  }
  if (typeof args.get("report-out") === "string") {
    await writeJsonFile(io, args.get("report-out") as string, report.evalReport);
  }
  writeJson(io, report);
}

async function liftRawEvalCommand(args: Map<string, string | boolean>, io: CliIO) {
  const dataset = JSON.parse(await io.readFile(stringArg(args, "dataset"), "utf8")) as EvalDataset;
  const attempts = JSON.parse(await io.readFile(stringArg(args, "attempts"), "utf8")) as EvalAttemptSet;
  const report = evaluateRawLiftAttempts(dataset, attempts);
  if (typeof args.get("summary-out") === "string") {
    await writeJsonFile(io, args.get("summary-out") as string, report);
  }
  writeJson(io, report);
}

async function parseCheckCommand(args: Map<string, string | boolean>, io: CliIO) {
  const schema = normalizeSchema(await readSchema(args, io));
  const mode = args.get("mode") === "syntax" ? "syntax" : "lint";
  const rawCypher = args.get("cypher");
  if (typeof rawCypher === "string") {
    writeJson(io, validateCypherTextWithParser(rawCypher, schema, { mode }));
    return;
  }
  const query = await readQuery(args, io);
  const defaultLimit = optionalNumber(args.get("default-limit"));
  const defaultMaxHops = optionalNumber(args.get("default-max-hops"));
  const repairOptions: { defaultLimit?: number; defaultMaxHops?: number } = {};
  if (defaultLimit !== undefined) {
    repairOptions.defaultLimit = defaultLimit;
  }
  if (defaultMaxHops !== undefined) {
    repairOptions.defaultMaxHops = defaultMaxHops;
  }
  const repaired = repairQuery(query, schema, repairOptions);
  const parserResult = validateCypherTextWithParser(renderQuery(repaired.query), schema, { mode });
  writeJson(io, {
    ...parserResult,
    repairs: repaired.applied,
    compilerDiagnostics: repaired.diagnostics
  });
}

async function proveCommand(args: Map<string, string | boolean>, io: CliIO) {
  const schema = normalizeSchema(await readSchema(args, io)).original;
  const query = await readQuery(args, io);
  const params = await readParams(args, io);
  const defaultLimit = optionalNumber(args.get("default-limit"));
  const defaultMaxHops = optionalNumber(args.get("default-max-hops"));
  const proofOptions: Parameters<typeof buildCypherProof>[3] = {};
  if (defaultLimit !== undefined) {
    proofOptions.defaultLimit = defaultLimit;
  }
  if (defaultMaxHops !== undefined) {
    proofOptions.defaultMaxHops = defaultMaxHops;
  }
  if (args.get("allow-writes") === true) {
    proofOptions.allowWrites = true;
  }
  if (args.get("approved") === true) {
    proofOptions.approved = true;
  }
  if (args.get("no-parser") === true) {
    proofOptions.includeParser = false;
  }
  proofOptions.parserMode = args.get("parser-mode") === "lint" ? "lint" : "syntax";
  const proof = buildCypherProof(query, schema, params, proofOptions);
  if (typeof args.get("proof-out") === "string") {
    await writeJsonFile(io, args.get("proof-out") as string, proof);
  }
  writeJson(io, proof);
  if (args.get("fail-on-blocked") === true && proof.status === "blocked") {
    throw new Error("Cypher proof is blocked.");
  }
}

async function policyCheckCommand(args: Map<string, string | boolean>, io: CliIO) {
  const schema = normalizeSchema(await readSchema(args, io)).original;
  const query = await readQuery(args, io);
  const maxReturnLimit = optionalNumber(args.get("max-return-limit"));
  const maxRelationshipHops = optionalNumber(args.get("max-relationship-hops"));
  const policyOptions: Parameters<typeof assessCypherPolicy>[2] = {};
  if (args.get("allow-writes") === true) {
    policyOptions.allowWrites = true;
  }
  if (args.get("no-require-limit") === true) {
    policyOptions.requireLimit = false;
  }
  if (maxReturnLimit !== undefined) {
    policyOptions.maxReturnLimit = maxReturnLimit;
  }
  if (maxRelationshipHops !== undefined) {
    policyOptions.maxRelationshipHops = maxRelationshipHops;
  }
  const report = assessCypherPolicy(query, schema, policyOptions);
  if (typeof args.get("report-out") === "string") {
    await writeJsonFile(io, args.get("report-out") as string, report);
  }
  writeJson(io, report);
  if (args.get("fail-on-error") === true && !report.ok) {
    throw new Error(`Cypher policy check found ${report.summary.errors} error(s).`);
  }
}

async function lspDiagnosticsCommand(args: Map<string, string | boolean>, io: CliIO) {
  const schema = normalizeSchema(await readSchema(args, io)).original;
  const uri = typeof args.get("uri") === "string" ? (args.get("uri") as string) : undefined;
  const parserMode = args.get("parser-mode") === "lint" ? "lint" : "syntax";
  const defaultLimit = optionalNumber(args.get("default-limit"));
  const defaultMaxHops = optionalNumber(args.get("default-max-hops"));
  const options: Parameters<typeof buildLspDiagnostics>[1] = { parserMode };
  if (uri !== undefined) {
    options.uri = uri;
  }
  if (defaultLimit !== undefined) {
    options.defaultLimit = defaultLimit;
  }
  if (defaultMaxHops !== undefined) {
    options.defaultMaxHops = defaultMaxHops;
  }
  const rawCypher = args.get("cypher");
  const report = typeof rawCypher === "string"
    ? buildLspDiagnostics({ schema, rawCypher }, options)
    : buildLspDiagnostics({ schema, query: await readQuery(args, io) }, options);
  if (typeof args.get("report-out") === "string") {
    await writeJsonFile(io, args.get("report-out") as string, report);
  }
  writeJson(io, report);
}

async function importText2CypherCommand(args: Map<string, string | boolean>, io: CliIO) {
  const csv = await io.readFile(stringArg(args, "csv"), "utf8");
  const imported = importText2CypherCsv(csv, importOptions(args, "text2cypher-import"));
  await writeImportedFixtureSet(args, io, imported);
}

async function importFunctionalCypherCommand(args: Map<string, string | boolean>, io: CliIO) {
  const json = await io.readFile(stringArg(args, "json"), "utf8");
  const imported = importFunctionalCypherJson(json, importOptions(args, "functional-cypher-import"));
  await writeImportedFixtureSet(args, io, imported);
}

async function importOpenCypherTckCommand(args: Map<string, string | boolean>, io: CliIO) {
  const feature = await io.readFile(stringArg(args, "feature"), "utf8");
  const imported = importOpenCypherTckFeature(feature, importOptions(args, "opencypher-tck-import"));
  await writeImportedFixtureSet(args, io, imported);
}

async function introspectNeo4jCommand(args: Map<string, string | boolean>, io: CliIO) {
  const neo4j = await import("neo4j-driver");
  const uri = stringArg(args, "uri");
  const user = typeof args.get("user") === "string" ? (args.get("user") as string) : "neo4j";
  const password = stringArg(args, "password");
  const sampleLimit = optionalNumber(args.get("sample-limit"));
  const driver = neo4j.default.driver(uri, neo4j.default.auth.basic(user, password));
  const session = driver.session();
  try {
    const schema = await introspectNeo4jSchema(session, {
      ...(sampleLimit !== undefined ? { sampleLimit } : {}),
      includeProcedures: args.get("no-procedures") !== true
    });
    if (typeof args.get("schema-out") === "string") {
      await writeJsonFile(io, args.get("schema-out") as string, schema);
    }
    writeJson(io, schema);
  } finally {
    await session.close();
    await driver.close();
  }
}

async function roadmapCommand(args: Map<string, string | boolean>, io: CliIO) {
  const roadmap = getYearsRoadmap();
  const includeIntegrity = args.get("integrity") === true;
  const format = args.get("format") === "markdown" ? "markdown" : "json";
  const output = format === "markdown"
    ? renderYearsRoadmapMarkdown(roadmap)
    : `${JSON.stringify(includeIntegrity ? { roadmap, integrity: roadmapIntegrityReport(roadmap) } : roadmap, null, 2)}\n`;
  if (typeof args.get("roadmap-out") === "string") {
    await writeTextFile(io, args.get("roadmap-out") as string, output);
  }
  io.stdout.write(output);
}

async function certifyDialectsCommand(args: Map<string, string | boolean>, io: CliIO) {
  const report = certifyDialectProfiles();
  const format = args.get("format") === "markdown" ? "markdown" : "json";
  const output = format === "markdown" ? renderDialectCertificationMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;
  if (typeof args.get("report-out") === "string") {
    await writeTextFile(io, args.get("report-out") as string, output);
  }
  io.stdout.write(output);
  if (args.get("fail-on-fail") === true && report.summary.failedChecks > 0) {
    throw new Error(`Dialect certification found ${report.summary.failedChecks} failing check(s).`);
  }
}

async function mcpCommand() {
  const { runMcpServer } = await import("./mcp-server.js");
  await runMcpServer(process.stdin, process.stdout);
}

async function serveCommand(args: Map<string, string | boolean>, io: CliIO) {
  const { createCompilerHttpServer } = await import("./http-server.js");
  const host = typeof args.get("host") === "string" ? (args.get("host") as string) : "127.0.0.1";
  const port = optionalNumber(args.get("port")) ?? 8787;
  const server = createCompilerHttpServer();
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  io.stderr.write(`cypher-llm compiler service listening on http://${host}:${port}\n`);
}

async function readSchema(args: Map<string, string | boolean>, io: CliIO): Promise<CypherSchemaContract> {
  return JSON.parse(await io.readFile(stringArg(args, "schema"), "utf8")) as CypherSchemaContract;
}

async function readQuery(args: Map<string, string | boolean>, io: CliIO): Promise<CypherQuery> {
  return JSON.parse(await io.readFile(stringArg(args, "query"), "utf8")) as CypherQuery;
}

async function readParams(
  args: Map<string, string | boolean>,
  io: CliIO
): Promise<Record<string, JsonLiteral>> {
  const path = args.get("params");
  if (typeof path !== "string") {
    return {};
  }
  return JSON.parse(await io.readFile(path, "utf8")) as Record<string, JsonLiteral>;
}

function parseArgs(args: string[]): Map<string, string | boolean> {
  const parsed = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function stringArg(args: Map<string, string | boolean>, name: string): string {
  const value = args.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function optionalNumber(value: string | boolean | undefined): number | undefined {
  if (value === undefined || typeof value === "boolean") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected number, received '${value}'`);
  }
  return parsed;
}

function importOptions(args: Map<string, string | boolean>, fallbackName: string): ImportOptions {
  const limit = optionalNumber(args.get("limit"));
  const indexesValue = args.get("indexes");
  const options: ImportOptions = {
    datasetName: typeof args.get("dataset-name") === "string" ? (args.get("dataset-name") as string) : fallbackName,
    source: typeof args.get("source") === "string" ? (args.get("source") as string) : fallbackName
  };
  if (typeof args.get("model") === "string") {
    options.model = args.get("model") as string;
  }
  if (typeof args.get("prompt") === "string") {
    options.prompt = args.get("prompt") as string;
  }
  if (limit !== undefined) {
    options.limit = limit;
  }
  if (typeof indexesValue === "string") {
    options.indexes = indexesValue
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value));
  }
  return options;
}

async function writeImportedFixtureSet(args: Map<string, string | boolean>, io: CliIO, imported: ImportedFixtureSet) {
  const datasetOut = stringArg(args, "dataset-out");
  const attemptsOut = stringArg(args, "attempts-out");
  const summaryOut = typeof args.get("summary-out") === "string" ? (args.get("summary-out") as string) : undefined;
  await writeJsonFile(io, datasetOut, imported.dataset);
  await writeJsonFile(io, attemptsOut, imported.attempts);
  if (summaryOut) {
    await writeJsonFile(io, summaryOut, imported.summary);
  }
  writeJson(io, imported.summary);
}

async function writeJsonFile(io: CliIO, filepath: string, value: unknown) {
  return writeTextFile(io, filepath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFile(io: CliIO, filepath: string, value: string) {
  if (!io.writeFile || !io.mkdir) {
    throw new Error("This CLI host does not support writing fixture files.");
  }
  await io.mkdir(path.dirname(filepath), { recursive: true });
  await io.writeFile(filepath, value, "utf8");
}

function writeJson(io: CliIO, value: unknown) {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): string {
  return `cypher-llm <command>

Commands:
  render      --schema schema.json --query query.json [--params params.json] [--default-limit 25] [--default-max-hops 5]
  validate    --schema schema.json --query query.json
  repair-raw  --schema schema.json --cypher "MATCH ..."
  lift-raw    --cypher "MATCH ..." [--schema schema.json] [--query-out query.json] [--summary-out summary.json] [--profile raw-compatible|llm-safe-readonly] [--mode syntax|lint]
  corpus
  eval        --dataset dataset.json --attempts attempts.json [--report-out report.json] [--raw-cypher-can-execute] [--default-limit 25] [--default-max-hops 5]
  compare-evals --baseline baseline.report.json --candidate candidate.report.json [--comparison-out comparison.json] [--fail-on-regression] [--tolerance 0.0001]
  repair-loop --dataset dataset.json --attempts attempts.json [--feedback-out feedback.json] [--report-out report.json] [--raw-cypher-can-execute] [--default-limit 25] [--default-max-hops 5]
  lift-raw-eval --dataset dataset.json --attempts attempts.json [--summary-out summary.json]
  parse-check --schema schema.json (--query query.json | --cypher "MATCH ...") [--mode lint|syntax] [--default-limit 25] [--default-max-hops 5]
  policy-check --schema schema.json --query query.json [--report-out report.json] [--fail-on-error] [--allow-writes] [--no-require-limit] [--max-return-limit 100] [--max-relationship-hops 5]
  lsp-diagnostics --schema schema.json (--query query.json | --cypher "MATCH ...") [--uri file:///query.cypher] [--report-out report.json] [--parser-mode syntax|lint] [--default-limit 25] [--default-max-hops 5]
  prove       --schema schema.json --query query.json [--params params.json] [--proof-out proof.json] [--fail-on-blocked] [--default-limit 25] [--default-max-hops 5] [--allow-writes] [--approved] [--parser-mode syntax|lint] [--no-parser]
  introspect-neo4j --uri bolt://localhost:7687 --user neo4j --password password [--schema-out schema.json] [--sample-limit 1000] [--no-procedures]
  roadmap    [--format json|markdown] [--integrity] [--roadmap-out path]
  certify-dialects [--format json|markdown] [--report-out path] [--fail-on-fail]
  mcp
  serve      [--host 127.0.0.1] [--port 8787]
  import-text2cypher --csv rows.csv --dataset-out dataset.json --attempts-out attempts.json [--summary-out summary.json] [--dataset-name name] [--source name] [--model name] [--limit 10] [--indexes 0,2,39]
  import-functional-cypher --json rows.json --dataset-out dataset.json --attempts-out attempts.json [--summary-out summary.json] [--dataset-name name] [--source name] [--limit 10]
  import-opencypher-tck --feature feature.file --dataset-out dataset.json --attempts-out attempts.json [--summary-out summary.json] [--dataset-name name] [--source name] [--limit 10]
  help
`;
}

function defaultIo(): CliIO {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    readFile: (filepath, encoding) => readFile(filepath, encoding),
    writeFile: (filepath, data, encoding) => writeFile(filepath, data, encoding),
    mkdir: (dir, options) => mkdir(dir, options)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runCli(process.argv.slice(2));
  process.exitCode = code;
}
