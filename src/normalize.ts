import type { CypherQuery } from "./ir.js";
import { renderQuery, type RenderOptions } from "./render.js";

export interface NormalizeOptions extends RenderOptions {
  trimTrailingWhitespace?: boolean;
}

export function normalizeQuery(query: CypherQuery, options: NormalizeOptions = {}): string {
  const rendered = renderQuery(query, options);
  const lines = rendered.split(/\r?\n/).map((line) => line.trimEnd());
  return (options.trimTrailingWhitespace ?? true ? lines : rendered.split(/\r?\n/)).join("\n").trim();
}

export function equivalentQueries(left: CypherQuery, right: CypherQuery, options: NormalizeOptions = {}): boolean {
  return normalizeQuery(left, options) === normalizeQuery(right, options);
}
