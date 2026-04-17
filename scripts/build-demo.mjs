#!/usr/bin/env node
/**
 * Regenerates the README hero images (docs/demo.svg, docs/demo-roast.svg) from
 * live CLI output. Run after changing any renderer so screenshots never drift
 * from real behavior.
 *
 *   npm run build && npm run demo
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CLI = resolve(ROOT, "dist/index.js");

function runCLI(args) {
  const r = spawnSync("node", [CLI, ...args], {
    env: { ...process.env, FORCE_COLOR: "1" },
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  // The CLI exits 1 on detected collisions; that is expected output, not a failure.
  return (r.stdout ?? "") + (r.stderr ?? "");
}

const ANSI = /\x1b\[[0-9;]*m/g;

function capBlocks(raw, kind, keep) {
  const lines = raw.split("\n");
  const out = [];
  let kept = 0;
  let skipping = false;
  let extra = 0;
  for (const line of lines) {
    const plain = line.replace(ANSI, "");
    const trimmed = plain.trimStart();
    if (trimmed.startsWith(`${kind}  `) || trimmed.startsWith(`${kind} `)) {
      if (kept >= keep) { extra++; skipping = true; continue; }
      kept++;
      skipping = false;
    } else if (skipping) {
      if (plain.trim() === "" || !plain.startsWith("    ")) {
        skipping = false;
        if (extra > 0) {
          const label = kind === "EXACT" ? "exact" : "similar";
          out.push(`   \x1b[90m... (${extra} more ${label} collisions)\x1b[39m`);
          out.push("");
          extra = 0;
        }
      } else {
        continue;
      }
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

function writeAnsi(content, dest) {
  writeFileSync(dest, content);
}

function runPython(input, output, title) {
  const r = spawnSync("python3", [
    resolve(__dirname, "ansi-to-svg.py"),
    input,
    output,
    title,
  ], { encoding: "utf-8" });
  if (r.status !== 0) {
    process.stderr.write(r.stderr);
    throw new Error(`ansi-to-svg.py failed (exit ${r.status})`);
  }
  process.stdout.write(r.stdout);
}

mkdirSync(resolve(ROOT, "docs"), { recursive: true });

const reportRaw = runCLI(["--config", "test-collision-config.json"]);
const reportTrimmed = capBlocks(capBlocks(reportRaw, "EXACT", 2), "SIMILAR", 1);
writeAnsi(reportTrimmed, "/tmp/mcpfix-report.ansi");
runPython("/tmp/mcpfix-report.ansi", resolve(ROOT, "docs/demo.svg"), "npx mcpfix");

const roastRaw = runCLI(["--config", "test-collision-config.json", "--roast"]);
writeAnsi(roastRaw, "/tmp/mcpfix-roast.ansi");
runPython("/tmp/mcpfix-roast.ansi", resolve(ROOT, "docs/demo-roast.svg"), "mcpfix --roast");

console.log("\nDemo SVGs regenerated.");
