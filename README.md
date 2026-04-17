# mcpfix — MCP Server Conflict Detector & Fixer

[![npm version](https://badge.fury.io/js/mcpfix.svg)](https://www.npmjs.com/package/mcpfix)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)
[![GitHub stars](https://img.shields.io/github/stars/pratikacharya1234/mcpdoctor?style=social)](https://github.com/pratikacharya1234/mcpdoctor)

> Detect tool name collisions, profile latency, and audit context window usage across Claude, Cursor, and Cline MCP servers.

## The Problem

Running multiple MCP servers? You have collisions. Two servers exposing `create_issue` means the AI picks the wrong one, burns tokens, and fails tasks. You don't know which server is slow. You don't know how much context your tools are eating. **mcpfix repairs this.**

## Architecture

```mermaid
flowchart TD
    A[mcpfix CLI] --> B[Config Loader]
    B -->|reads| C1[Claude Desktop config]
    B -->|reads| C2[Cursor mcp.json]
    B -->|reads| C3[Cline settings]
    B --> D[Server List]
    D --> E[Server Probe<br/>MCP stdio transport]
    E -->|tools/list x3 samples| F[ServerProfile]
    F --> G[Collision Engine<br/>exact + Levenshtein fuzzy]
    F --> H[Context Calculator<br/>token estimation]
    G --> I[DoctorReport]
    H --> I
    I --> J{Output mode}
    J -->|default| K[Terminal Report]
    J -->|--json| L[JSON stdout]
    J -->|--roast| M[Roast Report]
    J -->|--fix| N[Fixer<br/>server-key rename + backup]
    J -->|--dry-run| O[Preview<br/>no writes]
```

## Install & Run

```bash
npx mcpfix
```

Or install globally:

```bash
npm install -g mcpfix
mcpfix
```

## Features

- **Conflict Detection** — Finds exact and fuzzy tool name collisions across servers (Levenshtein-based)
- **Latency Profiling** — Measures cold-start time and steady-state warm RTT separately per server
- **Context Window Estimation** — Calculates how much of your token budget tools consume
- **Auto-Fix Mode** — `--fix` renames conflicting server keys in config with automatic backup
- **Dry-Run Preview** — `--dry-run` shows exactly what `--fix` would change without touching disk
- **Roast Mode** — `--roast` scores your MCP setup and surfaces real issues bluntly
- **Multi-Config Support** — Auto-detects Claude Desktop, Cursor, and Cline configs
- **CI/CD Ready** — JSON output mode (`--json`) with exit codes for pipelines

## Usage

```bash
# Auto-detect all MCP configs
npx mcpfix

# Specify a custom config file
npx mcpfix --config ./my-mcp-config.json

# JSON output for CI/CD
npx mcpfix --json

# Preview fixes without writing
npx mcpfix --dry-run

# Interactively fix conflicts
npx mcpfix --fix

# Roast your setup
npx mcpfix --roast

# Custom token budget
npx mcpfix --budget 128000
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --config <path>` | Custom MCP config file path | Auto-detect |
| `--json` | Output as JSON | false |
| `--fix` | Rename conflicting server keys in config (with backup) | false |
| `--dry-run` | Preview fixes without writing (implies `--fix`) | false |
| `--roast` | Score and roast your MCP setup | false |
| `--budget <tokens>` | Context window token budget | 200000 |

`--json` cannot be combined with `--fix` or `--dry-run` (interactive output would corrupt the JSON stream).

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All servers healthy, no conflicts |
| 1 | Errors or conflicts detected |
| 2 | Fatal error or invalid flag combination |

## Config Detection

mcpfix automatically finds configs from:

- **Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%/Claude/` (Windows), `~/.config/Claude/` (Linux)
- **Cursor** — `~/.cursor/mcp.json`
- **Cline** — VS Code global storage (`saoudrizwan.claude-dev`)

## How Conflict Detection Works

```text
Exact match:   tool_a == tool_a                   -> EXACT collision
Fuzzy match:   levenshtein(tool_a, tool_b) <= 4
               AND similarity >= 0.6              -> SIMILAR collision
```

The fuzzy pass catches near-identical names (`create_issue` / `create-issue`, `list_files` / `listfiles`) that cause the same routing ambiguity as exact matches.

## How --fix Works

`--fix` renames the *server key* in your MCP config file for the secondary server in each exact collision. This makes the host-side entry distinct without breaking the server process.

**What it changes:** the key name under `mcpServers` in the JSON config.
**What it does not change:** the tool names the server process advertises over stdio — those must be changed in the server's source code or via a proxy wrapper.

A `.mcpfix-backup` file is written alongside the config before any modifications. To roll back:

```bash
mv claude_desktop_config.json.mcpfix-backup claude_desktop_config.json
```

Use `--dry-run` first to preview the exact rename set without writing.

## Context Window Estimation

Token usage is estimated per tool as:

```text
tokens = ceil((len(name) + len(description) + len(JSON(inputSchema)) + 40) / 4)
```

The 40-byte overhead accounts for MCP framing (tool separator, JSON keys, whitespace). Risk thresholds:

| Usage   | Risk     |
| ------- | -------- |
| < 15%   | LOW      |
| 15-30%  | MODERATE |
| 30-50%  | HIGH     |
| > 50%   | CRITICAL |

## GitHub Action

Add MCP health checks to your CI:

```yaml
name: MCP Health Check
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx --yes mcpfix --json > mcp-report.json
      - name: Fail on collisions
        run: |
          COLLISIONS=$(jq '.collisions | length' mcp-report.json)
          [ "$COLLISIONS" -eq 0 ] || (echo "ERROR: $COLLISIONS collision(s) detected" && exit 1)
```

## Tech Stack

- TypeScript 5 + Node.js 18+
- `@modelcontextprotocol/sdk` — official MCP client over stdio transport
- `fastest-levenshtein` — O(n) Levenshtein for fuzzy matching
- Commander.js, Chalk 5, Ora 8, cli-table3, Boxen 7

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](https://github.com/pratikacharya1234/mcpdoctor/blob/main/CONTRIBUTING.md) for guidelines.

- [Open an issue](https://github.com/pratikacharya1234/mcpdoctor/issues)
- [Start a discussion](https://github.com/pratikacharya1234/mcpdoctor/discussions)

## License

MIT — see [LICENSE](https://github.com/pratikacharya1234/mcpdoctor/blob/main/LICENSE)

Made by [pratikacharya1234](https://github.com/pratikacharya1234)
