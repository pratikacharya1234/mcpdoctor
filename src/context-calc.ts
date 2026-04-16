import type { ServerProfile, ContextEstimate } from "./types.js";

const DEFAULT_TOKEN_BUDGET = 200_000;

/**
 * Token cost for a single tool definition as serialized in the MCP system prompt.
 *
 * Derivation: MCP encodes tools as JSON objects with "name", "description", and
 * "inputSchema" fields.  The 40-character overhead covers the JSON framing added
 * by the host (braces, commas, whitespace, list separators).  One token ≈ 4 UTF-8
 * characters is the widely-accepted approximation for English/code content.
 */
const FRAMING_OVERHEAD_CHARS = 40;
const CHARS_PER_TOKEN = 4;

function toolTokenCost(
  name: string,
  description: string | undefined,
  inputSchema: Record<string, unknown> | undefined
): number {
  const chars =
    name.length +
    (description?.length ?? 0) +
    (inputSchema ? JSON.stringify(inputSchema).length : 0) +
    FRAMING_OVERHEAD_CHARS;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function estimateContext(
  profiles: ServerProfile[],
  tokenBudget?: number
): ContextEstimate {
  // Guard: treat zero / negative / NaN budgets as "use default" to avoid
  // a division-by-zero that would produce Infinity% usage.
  const budget = tokenBudget != null && tokenBudget > 0 ? tokenBudget : DEFAULT_TOKEN_BUDGET;

  let totalTools = 0;
  let estimatedTokens = 0;

  for (const profile of profiles) {
    for (const tool of profile.tools) {
      totalTools++;
      estimatedTokens += toolTokenCost(tool.name, tool.description, tool.inputSchema);
    }
  }

  const usagePercent = Math.round((estimatedTokens / budget) * 10_000) / 100;
  const remainingCapacity = Math.max(0, budget - estimatedTokens);

  // Average tokens per tool, computed from the actual corpus — used by the
  // reporter to project how many more tools would fit in the remaining budget.
  const avgTokensPerTool =
    totalTools > 0 ? Math.ceil(estimatedTokens / totalTools) : 0;

  let riskLevel: ContextEstimate["riskLevel"];
  if (usagePercent < 15) riskLevel = "low";
  else if (usagePercent < 30) riskLevel = "moderate";
  else if (usagePercent < 50) riskLevel = "high";
  else riskLevel = "critical";

  return {
    totalTools,
    estimatedTokens,
    tokenBudget: budget,
    usagePercent,
    riskLevel,
    remainingCapacity,
    avgTokensPerTool,
  };
}
