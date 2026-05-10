#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import type { CypherQuery, CypherSchemaContract, JsonLiteral } from "./ir.js";
import type { EvalAttemptSet, EvalDataset } from "./evals.js";
import { evaluateAttempts } from "./evals.js";
import { evaluateFailureCorpus } from "./failure-corpus.js";
import { repairRawCypher } from "./repair.js";
import { createSafeExecutionPlan } from "./safety.js";
import { normalizeSchema } from "./schema.js";
import { validateQuery } from "./validate.js";

export interface CliIO {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
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
      case "corpus":
        writeJson(io, { results: evaluateFailureCorpus() });
        return 0;
      case "eval":
        await evalCommand(args, io);
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

async function evalCommand(args: Map<string, string | boolean>, io: CliIO) {
  const dataset = JSON.parse(await io.readFile(stringArg(args, "dataset"), "utf8")) as EvalDataset;
  const attempts = JSON.parse(await io.readFile(stringArg(args, "attempts"), "utf8")) as EvalAttemptSet;
  const defaultLimit = optionalNumber(args.get("default-limit"));
  const defaultMaxHops = optionalNumber(args.get("default-max-hops"));
  const evalOptions: { defaultLimit?: number; defaultMaxHops?: number } = {};
  if (defaultLimit !== undefined) {
    evalOptions.defaultLimit = defaultLimit;
  }
  if (defaultMaxHops !== undefined) {
    evalOptions.defaultMaxHops = defaultMaxHops;
  }
  writeJson(io, evaluateAttempts(dataset, attempts, evalOptions));
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

function writeJson(io: CliIO, value: unknown) {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): string {
  return `cypher-llm <command>

Commands:
  render      --schema schema.json --query query.json [--params params.json] [--default-limit 25] [--default-max-hops 5]
  validate    --schema schema.json --query query.json
  repair-raw  --schema schema.json --cypher "MATCH ..."
  corpus
  eval        --dataset dataset.json --attempts attempts.json [--default-limit 25] [--default-max-hops 5]
  help
`;
}

function defaultIo(): CliIO {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    readFile: (path, encoding) => readFile(path, encoding)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runCli(process.argv.slice(2));
  process.exitCode = code;
}
