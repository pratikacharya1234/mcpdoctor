import chalk from "chalk";
import boxen from "boxen";
import type { DoctorReport, ServerProfile } from "./types.js";

const ROASTS: Record<string, string[]> = {
  duplicate_servers: [
    "You have {n} servers running the same command for NO REASON",
    "Running {n} identical server processes -- pick one, commit",
    "{n} duplicate processes? This isn't redundancy, it's chaos",
  ],
  slow_server: [
    "{server} takes {latency}ms to cold start (get a better machine)",
    "{server} is slower than dial-up at {latency}ms. Your AI is aging waiting for it",
    "While {server} thinks about responding at {latency}ms, I've rewritten your entire codebase",
  ],
  too_many_tools: [
    "{n} tools but you only use 4 (skill issue)",
    "You're loading {n} tools into context and using like 3 of them. Peak hoarding",
    "{n} tools? Your AI spends more time reading tool definitions than doing work",
  ],
  context_bloat: [
    "Your MCP tools eat {pct}% of your context window. The AI can barely think",
    "At {pct}% context usage, your tools are louder than your prompts",
    "You're paying for tokens that tools are wasting. {pct}% gone before you even prompt",
  ],
  collisions: [
    "{n} tool name collisions -- your AI picks the wrong one and you don't even notice",
    "Two tools named the same thing? That's not redundancy, that's a bug factory",
    "{n} collisions detected. Your AI is basically flipping a coin",
  ],
  healthy: [
    "Honestly? This setup is surprisingly not terrible. Don't let it go to your head",
    "Clean config. For now. Give it a week.",
  ],
};

function pickRoast(category: string, vars: Record<string, string | number>): string {
  const options = ROASTS[category];
  if (!options || options.length === 0) return "";
  const template = options[Math.floor(Math.random() * options.length)];
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
}

function tierLabel(score: number): string {
  if (score >= 90) return chalk.green.bold("S  -- MCP Arch");
  if (score >= 70) return chalk.cyan.bold("A  -- MCP Pro");
  if (score >= 50) return chalk.yellow.bold("B  -- MCP Mid");
  if (score >= 30) return chalk.yellow.bold("C  -- MCP Slopper");
  if (score >= 10) return chalk.red.bold("D  -- MCP Disaster");
  return chalk.bgRed.white.bold("F  -- MCP Crime Scene");
}

export function renderRoast(report: DoctorReport): string {
  const lines: string[] = [];
  let score = 100;

  lines.push(
    boxen(chalk.bold.red(" MCP Roast Report "), {
      padding: 1,
      borderColor: "red",
      borderStyle: "round",
    })
  );
  lines.push("");

  // Detect duplicate server processes.
  //
  // Key insight: command alone is too coarse — "npx" would group every
  // npx-based server regardless of which package they run.  Instead, derive
  // a "binary identity" key:
  //   - package-manager launchers (npx/uvx/pipx/bunx): launcher + package-name
  //   - script runtimes (node/python/deno/bun): runtime + script-path
  //   - everything else: command basename
  //
  // This correctly identifies two filesystem servers as duplicates while
  // distinguishing a github-mcp from a filesystem-mcp even though both use npx.
  const LAUNCHERS = new Set(["npx", "uvx", "pipx", "bunx", "pnpx"]);
  const RUNTIMES  = new Set(["node", "python", "python3", "deno", "bun"]);

  function binaryKey(command: string, args: string[]): string {
    const base = command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? command;
    if (LAUNCHERS.has(base)) {
      const pkg = args.find((a) => !a.startsWith("-"));
      return pkg ? `${base}:${pkg}` : base;
    }
    if (RUNTIMES.has(base)) {
      const script = args.find((a) => !a.startsWith("-"));
      return script ? `${base}:${script}` : base;
    }
    return base;
  }

  const serverConfigs = new Map<string, { command: string; args: string[] }>();
  for (const cfg of report.configs) {
    for (const srv of cfg.servers) {
      serverConfigs.set(srv.name, { command: srv.command, args: srv.args });
    }
  }

  const commandGroups = new Map<string, ServerProfile[]>();
  for (const p of report.profiles) {
    const srv = serverConfigs.get(p.name);
    const key = srv ? binaryKey(srv.command, srv.args) : p.name;
    if (!commandGroups.has(key)) commandGroups.set(key, []);
    commandGroups.get(key)!.push(p);
  }

  for (const [, group] of commandGroups) {
    if (group.length > 1) {
      score -= 15 * (group.length - 1);
      lines.push(chalk.red(`  [!] ${pickRoast("duplicate_servers", { n: group.length })}`));
    }
  }

  // Slow / failed servers
  for (const p of report.profiles) {
    if (p.status === "slow") {
      score -= 10;
      lines.push(
        chalk.yellow(`  [slow] ${pickRoast("slow_server", { server: p.name, latency: p.coldStartMs })}`)
      );
    }
    if (p.status === "timeout") {
      score -= 20;
      lines.push(chalk.red(`  [T/O]  ${p.name} didn't even respond. Dead weight.`));
    }
    if (p.status === "error") {
      score -= 15;
      lines.push(chalk.red(`  [dead] ${p.name} is broken: ${p.error}`));
    }
  }

  // Tool count
  const totalTools = report.profiles.reduce((s, p) => s + p.tools.length, 0);
  if (totalTools > 30) {
    score -= 10;
    lines.push(chalk.yellow(`  [tools] ${pickRoast("too_many_tools", { n: totalTools })}`));
  }

  // Context bloat
  if (report.context.usagePercent > 15) {
    score -= 10;
    lines.push(chalk.yellow(`  [ctx] ${pickRoast("context_bloat", { pct: report.context.usagePercent })}`));
  }

  // Collisions
  if (report.collisions.length > 0) {
    score -= 10 * Math.min(report.collisions.length, 5);
    lines.push(chalk.red(`  [collision] ${pickRoast("collisions", { n: report.collisions.length })}`));
  }

  // Clean bill of health
  if (score >= 90) {
    lines.push(chalk.green(`  ${pickRoast("healthy", {})}`));
  }

  score = Math.max(score, 0);

  // Vibe percent equals the score: high score = high vibe, low score = high slop.
  const vibePercent = score;
  const slopPercent = 100 - vibePercent;
  lines.push("");
  lines.push(chalk.gray(`  Your setup is ${chalk.bold(`${vibePercent}% vibe, ${slopPercent}% slop`)}.\n`));

  lines.push(`  ${chalk.bold("Tier:")} ${tierLabel(score)}`);

  const fixCount = report.collisions.filter((c) => c.type === "exact").length;
  if (fixCount > 0) {
    lines.push(chalk.gray(`\n  Fix these ${fixCount} issue(s) to reach next tier. Run: ${chalk.bold("mcpfix --fix")}`));
  }

  lines.push("");
  return lines.join("\n");
}
