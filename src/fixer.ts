import { createInterface } from "readline";
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import chalk from "chalk";
import type { DoctorReport } from "./types.js";

// ---------------------------------------------------------------------------
// User interaction
// ---------------------------------------------------------------------------

/** Prompt the user with a yes/no question. Returns true only for "y" / "yes". */
async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// Config manipulation
// ---------------------------------------------------------------------------

function createBackup(path: string): string {
  const backupPath = `${path}.mcpdoctor-backup`;
  copyFileSync(path, backupPath);
  return backupPath;
}

function loadConfigJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Rename a server entry key within the mcpServers map in-place.
 *
 * MCP tool names are emitted by the server process itself; there is no config
 * field that rewrites them.  The structural change available at the config
 * level is renaming the server's *key* so the host entry is visually distinct.
 *
 * If `newName` is already occupied, a numeric suffix is appended until a free
 * slot is found.  Returns the name actually used and whether any change was made.
 */
function renameServerKey(
  config: Record<string, unknown>,
  oldName: string,
  newName: string
): { applied: boolean; finalName: string } {
  const mcpServers = (
    "mcpServers" in config
      ? (config.mcpServers as Record<string, unknown>)
      : config
  ) as Record<string, unknown>;

  if (!(oldName in mcpServers)) {
    return { applied: false, finalName: oldName };
  }

  let finalName = newName;
  let suffix = 2;
  while (finalName in mcpServers && finalName !== oldName) {
    finalName = `${newName}-${suffix++}`;
  }

  if (finalName === oldName) {
    return { applied: false, finalName: oldName };
  }

  mcpServers[finalName] = mcpServers[oldName];
  delete mcpServers[oldName];

  return { applied: true, finalName };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

interface PendingFix {
  configPath: string;
  serverName: string;
  suggestedName: string;
  toolName: string;
}

export async function interactiveFix(report: DoctorReport): Promise<void> {
  if (report.collisions.length === 0) {
    console.log(chalk.green("\n[OK] No conflicts to fix!\n"));
    return;
  }

  const exactCollisions = report.collisions.filter((c) => c.type === "exact");

  if (exactCollisions.length === 0) {
    console.log(chalk.yellow(
      "\n[!] Only fuzzy/similar conflicts found -- these require manual review.\n"
    ));
    return;
  }

  console.log(chalk.bold.cyan("\n[FIX] MCPDoctor Fix Mode\n"));
  console.log(chalk.gray(
    `Found ${exactCollisions.length} exact conflict(s) across ${report.configs.length} config(s)\n`
  ));

  // -------------------------------------------------------------------------
  // Build and preview the pending changes
  // -------------------------------------------------------------------------
  const pending: PendingFix[] = [];

  for (const collision of exactCollisions) {
    console.log(chalk.red(`  Conflict: ${chalk.bold(collision.toolName)}`));
    console.log(`  Servers: ${collision.servers.join(", ")}`);
    console.log();

    // The first server listed is treated as primary (keeps its name).
    // Every secondary server gets its config key renamed for disambiguation.
    for (const server of collision.servers.slice(1)) {
      const suggestedName = `${server}-ns`;
      const configPath = report.configs.find((c) =>
        c.servers.some((s) => s.name === server)
      )?.path ?? "";

      console.log(
        chalk.yellow(`  -> Rename config key "${server}" -> "${suggestedName}"`)
      );
      console.log(chalk.gray(
        `     Renames the host-side server entry; does NOT rename the tool "${collision.toolName}".\n` +
        `     To eliminate the collision at protocol level you must rename the tool in one\n` +
        `     server's source code, or route it through a proxy that rewrites tool names.`
      ));
      console.log();

      pending.push({ configPath, serverName: server, suggestedName, toolName: collision.toolName });
    }
  }

  const fixable = pending.filter((f) => f.configPath !== "");

  if (fixable.length === 0) {
    console.log(chalk.gray("No auto-fixable conflicts found (could not resolve config paths).\n"));
    return;
  }

  // -------------------------------------------------------------------------
  // Require explicit confirmation before mutating any file
  // -------------------------------------------------------------------------
  const configPaths = [...new Set(fixable.map((f) => f.configPath))];

  console.log(chalk.yellow(
    `This will modify ${configPaths.length} config file(s). ` +
    `Backups will be written with a .mcpdoctor-backup extension.`
  ));
  console.log();

  const proceed = await confirm(chalk.bold("Apply all fixes? [y/N] "));
  if (!proceed) {
    console.log(chalk.gray("\nAborted. No files were modified.\n"));
    return;
  }

  // -------------------------------------------------------------------------
  // Apply renames, grouped by config file to minimise write operations
  // -------------------------------------------------------------------------
  let totalApplied = 0;

  for (const configPath of configPaths) {
    const backupPath = createBackup(configPath);
    console.log(chalk.gray(`  Backup: ${backupPath}`));

    const config = loadConfigJson(configPath);
    const batch = fixable.filter((f) => f.configPath === configPath);

    for (const fix of batch) {
      const { applied, finalName } = renameServerKey(
        config,
        fix.serverName,
        fix.suggestedName
      );
      if (applied) {
        totalApplied++;
        console.log(
          chalk.green(`  [OK] Renamed: "${fix.serverName}" -> "${finalName}"`)
        );
      } else {
        console.log(
          chalk.gray(`  [skip] "${fix.serverName}" not found or already distinct`)
        );
      }
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log(chalk.green(`  [OK] Saved: ${configPath}`));
  }

  if (totalApplied === 0) {
    console.log(chalk.gray("\nNo renames were necessary.\n"));
    return;
  }

  console.log(chalk.green(
    `\n[OK] Applied ${totalApplied} rename(s). Backups saved with .mcpdoctor-backup extension.\n`
  ));
  console.log(chalk.yellow(
    "[!] Renaming the server key changes the host-side identifier only.\n" +
    "    To fully resolve the collision, rename the tool in one server's source code\n" +
    "    or wrap it in a proxy that rewrites tool names on the wire.\n" +
    "    Restart your MCP client for config changes to take effect.\n"
  ));
}
