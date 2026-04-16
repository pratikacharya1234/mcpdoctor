# Contributing to MCPDoctor

Thanks for taking the time to contribute. This document covers everything you need to go from idea to merged PR.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Submitting a Bug Report](#submitting-a-bug-report)
- [Submitting a Feature Request](#submitting-a-feature-request)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Message Format](#commit-message-format)

---

## Code of Conduct

Be direct, be technical, be respectful. Criticism of code is welcome; personal criticism is not. Issues and PRs that devolve into arguments will be closed.

---

## Ways to Contribute

| Type | Where |
| ---- | ------ |
| Bug report | [GitHub Issues](../../issues) |
| Feature request | [GitHub Discussions](../../discussions) |
| Code fix / feature | Pull Request |
| New MCP client support | Pull Request (see `src/config-loader.ts`) |
| Documentation | Pull Request |

---

## Development Setup

**Requirements:** Node.js >= 18, npm >= 9

```bash
git clone https://github.com/pratikacharya1234/mcpdoctor.git
cd mcpdoctor
npm install
npm run build       # compile TypeScript -> dist/
npm run lint        # tsc --noEmit (type check only)
```

**Run against your own MCP config:**

```bash
node dist/index.js
```

**Run against the bundled test configs:**

```bash
# Single server (no conflicts)
node dist/index.js --config test-config.json

# Two filesystem servers (all-tool collision)
node dist/index.js --config test-collision-config.json
```

---

## Project Structure

```
src/
  index.ts           CLI entry point, option parsing, orchestration
  types.ts           All shared TypeScript interfaces
  config-loader.ts   Reads Claude Desktop / Cursor / Cline config files
  server-probe.ts    Connects to each MCP server, measures cold start + warm RTT
  collision-engine.ts Exact + Levenshtein fuzzy collision detection
  context-calc.ts    Token usage estimation from tool definitions
  reporter.ts        Terminal report renderer (tables, progress bar)
  roast.ts           Roast mode renderer + scoring
  fixer.ts           Interactive config-file fix (server-key rename + backup)
```

---

## Submitting a Bug Report

Use [GitHub Issues](../../issues). Include:

1. **mcpdoctor version** — `npx mcpdoctor --version`
2. **Node.js version** — `node --version`
3. **OS and MCP client** (Claude Desktop / Cursor / Cline / custom)
4. **Command you ran** and the **full output** (redact sensitive paths if needed)
5. **Expected behavior** vs **actual behavior**

If the bug involves a specific MCP server, include its `command` and `args` (not env vars — those may contain secrets).

---

## Submitting a Feature Request

Open a [GitHub Discussion](../../discussions) before writing any code for non-trivial features. This avoids duplicate effort and lets us agree on scope before you invest time.

Good candidates for PRs without prior discussion:
- Adding a new MCP client config path (new editor support)
- Fixing an incorrect threshold or heuristic
- Improving error messages
- Documentation fixes

---

## Pull Request Process

1. **Fork** the repo and create a branch from `main`:
   ```bash
   git checkout -b fix/your-topic
   ```

2. **Make your changes.** Keep the scope tight — one concern per PR.

3. **Type-check** before pushing:
   ```bash
   npm run lint
   ```

4. **Build** to confirm the full pipeline is clean:
   ```bash
   npm run build
   ```

5. **Test manually** with at least one real or test config file:
   ```bash
   node dist/index.js --config test-config.json
   node dist/index.js --config test-collision-config.json --roast
   node dist/index.js --config test-collision-config.json --json | python3 -m json.tool
   ```

6. **Open the PR** against `main`. Fill in the template:
   - What changed and why
   - How to test it
   - Any breaking changes

PRs that break the TypeScript build or produce invalid JSON output will not be merged until fixed.

---

## Coding Standards

- **TypeScript strict mode** — no `any` casts without a comment explaining why
- **No emojis** in source code or terminal output — use bracketed text labels (`[OK]`, `[!]`, `[ERR]`)
- **No magic constants** — name every threshold and explain its derivation in a comment
- **No placeholder code** — every function must do real work; stubs and `// TODO` must not be committed
- **No speculative features** — implement only what the PR describes
- **Error messages go to stderr** — stdout is reserved for machine-readable output in `--json` mode
- **Exit codes are contract** — 0 = clean, 1 = issues found, 2 = fatal/usage error; do not change without a major version bump

---

## Commit Message Format

```
<type>: <short imperative summary>

<optional body — explain the why, not the what>
```

Types: `fix`, `feat`, `refactor`, `docs`, `test`, `chore`

Examples:

```
fix: guard --budget 0 from producing Infinity% context usage

feat: add Windsurf MCP config path detection

docs: update demo output to show Cold Start / Warm RTT columns
```

Keep the subject line under 72 characters. No trailing period.

---

## Adding a New MCP Client

Add an entry to `CONFIG_PATHS` in [src/config-loader.ts](src/config-loader.ts):

```typescript
"Your Client": () => {
  const home = homedir();
  if (process.platform === "darwin") {
    return [join(home, "path/to/client/mcp-config.json")];
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return [join(appData, "path/to/client/mcp-config.json")];
  }
  return [join(home, ".config/path/to/client/mcp-config.json")];
},
```

Include a link to the client's documentation showing where it stores its MCP config in the PR description.
