export type DiagnosticSeverity = "error" | "warning" | "info";

export interface RepairHint {
  kind:
    | "add-limit"
    | "escape-identifier"
    | "fix-direction"
    | "declare-parameter"
    | "restore-scope"
    | "bound-path"
    | "manual";
  description: string;
  replacement?: unknown;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  suggestion?: string;
  repair?: RepairHint;
}

export interface DiagnosticInput {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  suggestion?: string;
  repair?: RepairHint;
}

export function diagnostic(input: DiagnosticInput): Diagnostic {
  const output: Diagnostic = {
    code: input.code,
    severity: input.severity,
    message: input.message
  };
  if (input.path) {
    output.path = input.path;
  }
  if (input.suggestion) {
    output.suggestion = input.suggestion;
  }
  if (input.repair) {
    output.repair = input.repair;
  }
  return output;
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}
