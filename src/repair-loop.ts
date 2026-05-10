import type { EvalAttemptSet, EvalDataset, EvalOptions, EvalReport, EvalResult } from "./evals.js";
import { evaluateAttempts } from "./evals.js";
import type { CypherSchemaContract } from "./ir.js";

export interface RepairLoopReport {
  version: "cypher-llm-repair-loop/v1";
  datasetName: string;
  model?: string;
  prompt?: string;
  evalReport: EvalReport;
  packets: RepairFeedbackPacket[];
  metrics: {
    failedTasks: number;
    packets: number;
    executableFailures: number;
    expectationFailures: number;
    diagnosticFailures: Record<string, number>;
  };
}

export interface RepairFeedbackPacket {
  version: "cypher-llm-repair-packet/v1";
  taskId: string;
  question: string;
  schema: CypherSchemaContract;
  attempt: {
    kind: EvalResult["kind"];
    cypher?: string;
    canExecute: boolean;
  };
  diagnostics: RepairDiagnostic[];
  failedExpectations: EvalResult["expectationResults"];
  instruction: string;
}

export interface RepairDiagnostic {
  code: string;
  message: string;
  suggestion: string;
}

const REPAIR_HINTS: Record<string, Omit<RepairDiagnostic, "code">> = {
  "undefined-variable": {
    message: "A variable is referenced outside its visible Cypher scope.",
    suggestion: "Project the variable through WITH, return it from CALL {}, or rename the reference to an in-scope alias."
  },
  "unknown-label": {
    message: "The query uses a label that is not declared in the schema contract.",
    suggestion: "Use one of the schema.nodes names or aliases."
  },
  "unknown-relationship-type": {
    message: "The query uses a relationship type that is not declared in the schema contract.",
    suggestion: "Use one of the schema.relationships types or aliases."
  },
  "relationship-direction-mismatch": {
    message: "The relationship direction does not match declared schema endpoints.",
    suggestion: "Flip the relationship direction or adjust endpoint labels."
  },
  "missing-limit": {
    message: "The query lacks an explicit LIMIT in an LLM-safe read profile.",
    suggestion: "Add a bounded LIMIT to the RETURN clause."
  },
  "aggregate-in-match-where": {
    message: "MATCH WHERE runs before aggregation and cannot contain aggregate calls.",
    suggestion: "Project the aggregate in WITH or RETURN, alias it, then filter on the alias."
  },
  "aggregate-alias-required": {
    message: "An aggregate projection lacks a stable alias.",
    suggestion: "Add an alias such as AS countValue and reference that alias later."
  },
  "invalid-aggregation": {
    message: "A post-projection predicate repeats an aggregate call.",
    suggestion: "Filter or order by the aggregate alias instead of recomputing the aggregate."
  },
  "ambiguous-aggregation-expression": {
    message: "A projection mixes aggregate and non-aggregate variable references.",
    suggestion: "Project grouping keys and aggregate values separately, then combine aliases in a later clause."
  },
  "subquery-import-undefined": {
    message: "CALL {} imports a variable that does not exist in the outer scope.",
    suggestion: "Move the CALL after the variable is introduced or remove the import."
  },
  "unknown-procedure-yield": {
    message: "A procedure YIELD item is not declared by schema.procedures metadata.",
    suggestion: "Use a declared yield variable or update the procedure metadata."
  },
  "raw-cypher-escape-hatch": {
    message: "Raw Cypher bypasses schema-aware IR validation.",
    suggestion: "Rewrite the raw fragment as structured CypherQuery IR when possible."
  },
  "raw-expression-escape-hatch": {
    message: "A raw expression bypasses schema-aware expression validation.",
    suggestion: "Rewrite the expression using structured IR nodes when possible."
  },
  "no-cypher-output": {
    message: "The model did not return a Cypher query.",
    suggestion: "Return CypherQuery IR JSON or a raw Cypher query only."
  },
  timeout: {
    message: "The model attempt timed out.",
    suggestion: "Retry with a smaller schema slice and a more constrained output contract."
  }
};

export function evaluateRepairLoop(
  dataset: EvalDataset,
  attempts: EvalAttemptSet,
  options: EvalOptions = {}
): RepairLoopReport {
  const evalReport = evaluateAttempts(dataset, attempts, options);
  const packets = repairFeedbackPackets(dataset, evalReport);
  return {
    version: "cypher-llm-repair-loop/v1",
    datasetName: dataset.name,
    ...(attempts.model ? { model: attempts.model } : {}),
    ...(attempts.prompt ? { prompt: attempts.prompt } : {}),
    evalReport,
    packets,
    metrics: {
      failedTasks: evalReport.metrics.failedTasks,
      packets: packets.length,
      executableFailures: packets.filter((packet) => !packet.attempt.canExecute).length,
      expectationFailures: packets.filter((packet) => packet.failedExpectations.length > 0).length,
      diagnosticFailures: countDiagnostics(packets)
    }
  };
}

export function repairFeedbackPackets(dataset: EvalDataset, report: EvalReport): RepairFeedbackPacket[] {
  const tasksById = new Map(dataset.tasks.map((task) => [task.id, task]));
  return report.results
    .filter((result) => !result.passed || !result.canExecute || result.diagnostics.length > 0)
    .map((result) => {
      const task = tasksById.get(result.taskId);
      if (!task) {
        throw new Error(`Repair packet requested for unknown task '${result.taskId}'.`);
      }
      const failedExpectations = result.expectationResults.filter((expectation) => !expectation.passed);
      return {
        version: "cypher-llm-repair-packet/v1",
        taskId: result.taskId,
        question: result.question,
        schema: task.schema,
        attempt: {
          kind: result.kind,
          ...(result.cypher ? { cypher: result.cypher } : {}),
          canExecute: result.canExecute
        },
        diagnostics: result.diagnostics.map(repairDiagnostic),
        failedExpectations,
        instruction: repairInstruction(result, failedExpectations)
      };
    });
}

export function repairDiagnostic(code: string): RepairDiagnostic {
  return {
    code,
    ...(REPAIR_HINTS[code] ?? {
      message: "The compiler reported a diagnostic for this attempt.",
      suggestion: "Use the diagnostic code, rendered Cypher, and schema contract to produce a corrected CypherQuery IR attempt."
    })
  };
}

function repairInstruction(result: EvalResult, failedExpectations: EvalResult["expectationResults"]): string {
  const base = "Produce a corrected CypherQuery IR attempt. Preserve the user's question and use only schema identifiers from the provided schema contract.";
  if (!result.canExecute) {
    return `${base} The current attempt is not executable; fix diagnostics before optimizing result shape.`;
  }
  if (failedExpectations.length > 0) {
    return `${base} The current attempt executes but misses expected eval assertions; satisfy the failed expectations.`;
  }
  return `${base} The attempt produced diagnostics; remove avoidable diagnostics while preserving semantics.`;
}

function countDiagnostics(packets: RepairFeedbackPacket[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const packet of packets) {
    for (const diagnostic of packet.diagnostics) {
      counts[diagnostic.code] = (counts[diagnostic.code] ?? 0) + 1;
    }
  }
  return counts;
}
