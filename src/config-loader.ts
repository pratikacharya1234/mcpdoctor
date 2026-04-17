import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { MCPConfig, MCPServerConfig } from "./types.js";

interface RawMCPServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Cline and some other clients mark disabled servers rather than removing them. */
  disabled?: boolean;
}

type RawMCPConfig = Record<string, RawMCPServerEntry>;

/**
 * Candidate config paths per client, resolved at call time so that environment
 * variables (APPDATA, HOME) are evaluated lazily and always reflect the live
 * environment.
 */
const CONFIG_PATHS: Record<string, () => string[]> = {
  "Claude Desktop": () => {
    const home = homedir();
    if (process.platform === "darwin") {
      return [
        join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      ];
    }
    if (process.platform === "win32") {
      const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
      return [join(appData, "Claude", "claude_desktop_config.json")];
    }
    // Linux / BSD
    return [join(home, ".config", "Claude", "claude_desktop_config.json")];
  },

  "Cursor": () => [join(homedir(), ".cursor", "mcp.json")],

  "Cline": () => {
    const home = homedir();
    const clineRelPath = join(
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json"
    );
    if (process.platform === "darwin") {
      return [
        join(home, "Library", "Application Support", "Code", "User", "globalStorage", clineRelPath),
        join(home, "Library", "Application Support", "Code - Insiders", "User", "globalStorage", clineRelPath),
      ];
    }
    if (process.platform === "win32") {
      const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
      return [
        join(appData, "Code", "User", "globalStorage", clineRelPath),
        join(appData, "Code - Insiders", "User", "globalStorage", clineRelPath),
      ];
    }
    // Linux / BSD
    return [
      join(home, ".config", "Code", "User", "globalStorage", clineRelPath),
      join(home, ".config", "Code - Insiders", "User", "globalStorage", clineRelPath),
    ];
  },
};

/**
 * Parse the raw `mcpServers` map into typed server configs.
 *
 * Entries missing a `command` field (malformed) or explicitly disabled are
 * silently dropped — they cannot be probed and would only produce noise.
 */
function parseRawConfig(raw: RawMCPConfig): MCPServerConfig[] {
  return Object.entries(raw)
    .filter(([, entry]) => !entry.disabled && typeof entry.command === "string" && entry.command.length > 0)
    .map(([name, entry]) => ({
      name,
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env,
    }));
}

/**
 * Attempt to load an MCP config from the first existing path in `paths`.
 * Returns null when no path exists or when every parse attempt fails.
 * Parse errors are propagated via stderr so the user knows a config was skipped.
 */
function tryLoadConfig(source: string, paths: string[]): MCPConfig | null {
  for (const configPath of paths) {
    if (!existsSync(configPath)) continue;
    try {
      const content = readFileSync(configPath, "utf-8");
      const json = JSON.parse(content) as Record<string, unknown>;
      // Normalise: Claude Desktop / Cursor / Cline all nest under "mcpServers".
      // Some custom configs use a flat top-level object instead.
      const raw = (json.mcpServers ?? json) as RawMCPConfig;
      const servers = parseRawConfig(raw);
      return { source, path: configPath, servers };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[mcpfix] Warning: could not parse ${source} config at ${configPath}: ${msg}\n`);
    }
  }
  return null;
}

export function loadCustomConfig(configPath: string): MCPConfig {
  const content = readFileSync(configPath, "utf-8");
  const json = JSON.parse(content) as Record<string, unknown>;
  const raw = (json.mcpServers ?? json) as RawMCPConfig;
  const servers = parseRawConfig(raw);
  return { source: "Custom", path: configPath, servers };
}

export function loadAllConfigs(): MCPConfig[] {
  const configs: MCPConfig[] = [];
  for (const [source, pathFn] of Object.entries(CONFIG_PATHS)) {
    const result = tryLoadConfig(source, pathFn());
    if (result && result.servers.length > 0) {
      configs.push(result);
    }
  }
  return configs;
}

export function getAllServers(configs: MCPConfig[]): MCPServerConfig[] {
  return configs.flatMap((c) => c.servers);
}
