#!/usr/bin/env node

import { createRequire } from "module";
import { Command } from "commander";
import ora from "ora";
import { loadAllConfigs, loadCustomConfig, getAllServers } from "./config-loader.js";
import { probeAllServers } from "./server-probe.js";
import { detectCollisions } from "./collision-engine.js";
import { estimateContext } from "./context-calc.js";
import { renderReport, renderJSON } from "./reporter.js";
import { interactiveFix } from "./fixer.js";
import { renderRoast } from "./roast.js";
import type { DoctorReport } from "./types.js";

// Read version from package.json at runtime so there is a single source of truth.
const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

const program = new Command();

program
  .name("mcpfix")
  .description("MCP Server Conflict Detector & Profiler")
  .version(version)
  .option("-c, --config <path>", "Custom MCP config file path")
  .option("--json", "Output as JSON (for CI/CD)")
  .option("--fix", "Interactively fix detected conflicts")
  .option("--dry-run", "Preview fixes without writing (implies --fix)")
  .option("--roast", "Roast your MCP setup")
  .option("--budget <tokens>", "Context window token budget", "200000")
  .action(async (options) => {
    // --json and --fix together would corrupt the JSON output with interactive
    // prompts on stdout.  Fail early with a clear message.
    if (options.json && (options.fix || options.dryRun)) {
      process.stderr.write(
        "[mcpfix] Error: --json and --fix/--dry-run cannot be used together.\n" +
        "  Run without --json to use interactive fix or dry-run mode.\n"
      );
      process.exit(2);
    }

    const spinner = ora("Scanning MCP configs...").start();

    try {
      // 1. Load configs
      let configs;
      if (options.config) {
        const custom = loadCustomConfig(options.config);
        configs = [custom];
      } else {
        configs = loadAllConfigs();
      }

      if (configs.length === 0) {
        spinner.fail("No MCP configs found. Use --config to specify a config file.");
        process.exit(1);
      }

      const servers = getAllServers(configs);

      if (servers.length === 0) {
        spinner.fail("No MCP servers found in any config.");
        process.exit(1);
      }

      spinner.text = `Found ${servers.length} server(s) across ${configs.length} config(s). Probing (up to 6 concurrent)...`;

      // 2. Probe all servers (bounded concurrency pool — see server-probe.ts)
      const profiles = await probeAllServers(servers);

      spinner.text = "Detecting collisions and estimating context...";

      // 3. Detect collisions
      const collisions = detectCollisions(profiles);

      // 4. Estimate context window usage
      const budget = parseInt(options.budget, 10);
      const context = estimateContext(profiles, isNaN(budget) || budget <= 0 ? undefined : budget);

      // 5. Build report
      const report: DoctorReport = {
        configs,
        profiles,
        collisions,
        context,
        timestamp: new Date().toISOString(),
      };

      spinner.stop();

      // 6. Output
      if (options.roast) {
        console.log(renderRoast(report));
      } else if (options.json) {
        console.log(renderJSON(report));
      } else {
        console.log(renderReport(report));
      }

      // 7. Fix mode — interactive, so only runs when not in JSON/CI mode
      if (options.fix || options.dryRun) {
        if (collisions.length === 0) {
          console.log("[OK] No conflicts found. Nothing to fix.\n");
        } else {
          await interactiveFix(report, options.dryRun);
        }
      }

      // Exit code: 1 when there are errors OR collisions (CI/CD integration)
      const hasErrors = profiles.some(
        (p) => p.status === "error" || p.status === "timeout"
      );
      process.exit(hasErrors || collisions.length > 0 ? 1 : 0);
    } catch (err) {
      spinner.fail("Fatal error");
      process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
      process.exit(2);
    }
  });

program.parse();
