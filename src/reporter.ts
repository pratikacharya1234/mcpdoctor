import chalk from "chalk";
import Table from "cli-table3";
import boxen from "boxen";
import type { DoctorReport, ServerProfile, Collision, ContextEstimate } from "./types.js";

function statusIcon(status: ServerProfile["status"]): string {
  switch (status) {
    case "healthy": return chalk.green("[OK]");
    case "slow":    return chalk.yellow("[!]");
    case "error":   return chalk.red("[ERR]");
    case "timeout": return chalk.red("[T/O]");
  }
}

/** Color-code cold-start latency: green < 500ms, yellow < 2000ms, red >= 2000ms. */
function coldStartLabel(ms: number): string {
  if (ms < 500)  return chalk.green(`${ms}ms`);
  if (ms < 2000) return chalk.yellow(`${ms}ms`);
  return chalk.red(`${ms}ms`);
}

/** Color-code warm RTT: green < 100ms, yellow < 500ms, red >= 500ms. */
function warmRttLabel(ms: number): string {
  if (ms === 0)  return chalk.gray("n/a");
  if (ms < 100)  return chalk.green(`${ms}ms`);
  if (ms < 500)  return chalk.yellow(`${ms}ms`);
  return chalk.red(`${ms}ms`);
}

function riskLabel(level: ContextEstimate["riskLevel"]): string {
  switch (level) {
    case "low":      return chalk.green("LOW");
    case "moderate": return chalk.yellow("MODERATE");
    case "high":     return chalk.red("HIGH");
    case "critical": return chalk.bgRed.white("CRITICAL");
  }
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function renderServerTable(profiles: ServerProfile[]): string {
  const table = new Table({
    head: [
      chalk.cyan("Server"),
      chalk.cyan("Tools"),
      chalk.cyan("Cold Start"),
      chalk.cyan("Warm RTT"),
      chalk.cyan("Status"),
    ],
    style: { head: [], border: ["gray"] },
  });

  for (const p of profiles) {
    table.push([
      p.name,
      String(p.tools.length),
      coldStartLabel(p.coldStartMs),
      warmRttLabel(p.warmLatencyMs),
      `${statusIcon(p.status)} ${p.status}`,
    ]);
  }

  return table.toString();
}

function renderCollisions(collisions: Collision[]): string {
  if (collisions.length === 0) {
    return chalk.green("\n[OK] No tool name collisions detected\n");
  }

  const lines: string[] = [chalk.red.bold("\nCONFLICTS DETECTED:\n")];

  for (const c of collisions) {
    const typeLabel = c.type === "exact"
      ? chalk.bgRed.white(" EXACT ")
      : chalk.bgYellow.black(" SIMILAR ");

    lines.push(`  ${typeLabel} ${chalk.bold(c.toolName)}`);
    lines.push(`    Servers: ${c.servers.join(", ")}`);

    if (c.similarity !== undefined) {
      lines.push(`    Similarity: ${Math.round(c.similarity * 100)}%`);
    }

    if (c.suggestion) {
      lines.push(`    ${chalk.gray("Fix:")} ${c.suggestion}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderContextBar(context: ContextEstimate): string {
  const barWidth = 30;
  const filled = Math.min(Math.round((context.usagePercent / 100) * barWidth), barWidth);
  const empty = barWidth - filled;

  const barColor =
    context.riskLevel === "low"      ? chalk.green :
    context.riskLevel === "moderate" ? chalk.yellow :
    chalk.red;

  const bar = barColor("=".repeat(filled)) + chalk.gray("-".repeat(empty));

  const toolCapacity =
    context.avgTokensPerTool > 0
      ? `~${Math.round(context.remainingCapacity / context.avgTokensPerTool)} more tools`
      : "unknown";

  return [
    chalk.cyan.bold("\nCONTEXT WINDOW:\n"),
    `  [${bar}] ${context.usagePercent}%`,
    `  Tools: ${context.totalTools} | Tokens: ${formatTokens(context.estimatedTokens)} / ${formatTokens(context.tokenBudget)}`,
    `  Risk: ${riskLabel(context.riskLevel)}`,
    `  Remaining: ~${formatTokens(context.remainingCapacity)} tokens (${toolCapacity} at avg ${context.avgTokensPerTool} tok/tool)`,
  ].join("\n");
}

export function renderReport(report: DoctorReport): string {
  const sections: string[] = [];

  sections.push(
    boxen(
      chalk.bold.cyan(" MCPFix ") + chalk.gray("-- MCP Server Conflict Detector & Profiler"),
      { padding: 1, borderColor: "cyan", borderStyle: "round" }
    )
  );

  if (report.configs.length > 0) {
    const configLines = report.configs
      .map((c) => `  ${chalk.green("*")} ${c.source}: ${chalk.gray(c.path)}`)
      .join("\n");
    sections.push(`\nCONFIGS:\n${configLines}`);
  }

  sections.push(`\nLATENCY PROFILE:\n${renderServerTable(report.profiles)}`);

  const errors = report.profiles.filter((p) => p.error);
  if (errors.length > 0) {
    sections.push(chalk.red.bold("\nERRORS:"));
    for (const e of errors) {
      sections.push(`  ${chalk.bold(e.name)}: ${e.error}`);
    }
  }

  sections.push(renderCollisions(report.collisions));
  sections.push(renderContextBar(report.context));

  const totalTools = report.profiles.reduce((s, p) => s + p.tools.length, 0);
  const healthyCount = report.profiles.filter((p) => p.status === "healthy").length;
  const collisionCount = report.collisions.length;

  const summaryColor = collisionCount > 0 ? chalk.yellow : chalk.green;
  sections.push(
    summaryColor(
      `\nSummary: ${report.profiles.length} servers, ${totalTools} tools, ` +
      `${healthyCount} healthy, ${collisionCount} conflicts\n`
    )
  );

  return sections.join("\n");
}

export function renderJSON(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}
