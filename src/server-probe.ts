import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig, ServerProfile, MCPTool } from "./types.js";

const PROBE_TIMEOUT_MS = 10_000;
/** Number of tools/list calls made *after* the cold-start connection to measure steady-state RTT. */
const WARM_SAMPLES = 2;
/** Cap concurrent child process spawns to avoid file-descriptor / memory exhaustion. */
const MAX_CONCURRENT_PROBES = 6;
/** Cold-start threshold above which a server is flagged "slow". */
const SLOW_COLD_MS = 2_000;
/** Warm RTT threshold above which a server is flagged "slow". */
const SLOW_WARM_MS = 800;

/**
 * Create a transport, attach a stderr collector before the process is spawned,
 * then connect a client. Returns the client and a zero-argument accessor that
 * returns whatever the server has written to stderr so far (capped at 512 bytes).
 *
 * The SDK creates the PassThrough stream in the constructor (before start()),
 * so listeners attached here will receive all data without any race condition.
 */
async function connectWithStderrCapture(config: MCPServerConfig): Promise<{
  client: Client;
  getStderr: () => string;
}> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    stderr: "pipe",
  });

  const chunks: Buffer[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
  const getStderr = (): string =>
    Buffer.concat(chunks).toString("utf-8").trim().slice(0, 512);

  const client = new Client(
    { name: "mcpdoctor", version: "0.1.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return { client, getStderr };
}

async function fetchTools(client: Client): Promise<MCPTool[]> {
  const result = await client.listTools();
  return (result.tools as MCPTool[]).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown> | undefined,
  }));
}

export async function probeServer(config: MCPServerConfig): Promise<ServerProfile> {
  let client: Client | undefined;
  let getStderr: () => string = () => "";
  const t0 = performance.now();

  try {
    const connected = await Promise.race([
      connectWithStderrCapture(config),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), PROBE_TIMEOUT_MS)
      ),
    ]);
    client = connected.client;
    getStderr = connected.getStderr;

    // Cold start: connection + first tools/list — this is what the user waits for on MCP client launch.
    const tools = await fetchTools(client);
    const coldStartMs = Math.round(performance.now() - t0);

    // Warm samples: subsequent tools/list calls with the connection already open.
    // These represent steady-state per-call RTT during an active session.
    const warmMs: number[] = [];
    for (let i = 0; i < WARM_SAMPLES; i++) {
      const ts = performance.now();
      await fetchTools(client);
      warmMs.push(performance.now() - ts);
    }
    const warmLatencyMs = Math.round(
      warmMs.reduce((a, b) => a + b, 0) / warmMs.length
    );

    await client.close();

    const status: ServerProfile["status"] =
      coldStartMs > SLOW_COLD_MS || warmLatencyMs > SLOW_WARM_MS ? "slow" : "healthy";

    return { name: config.name, tools, coldStartMs, warmLatencyMs, status };
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    const base = err instanceof Error ? err.message : String(err);
    const stderr = getStderr();
    const errorDetail = stderr ? `${base} -- stderr: ${stderr}` : base;

    try { await client?.close(); } catch { /* transport already dead */ }

    if (base.includes("timeout")) {
      return {
        name: config.name,
        tools: [],
        coldStartMs: elapsed,
        warmLatencyMs: 0,
        status: "timeout",
        error: `Server did not respond within ${PROBE_TIMEOUT_MS / 1000}s`,
      };
    }

    return {
      name: config.name,
      tools: [],
      coldStartMs: elapsed,
      warmLatencyMs: 0,
      status: "error",
      error: errorDetail,
    };
  }
}

/**
 * Probe all servers with a bounded concurrency pool.
 *
 * Spawning every server simultaneously (Promise.all) causes file-descriptor
 * and memory pressure at scale. A worker-pool pattern caps concurrent child
 * processes at MAX_CONCURRENT_PROBES while preserving result order.
 */
export async function probeAllServers(servers: MCPServerConfig[]): Promise<ServerProfile[]> {
  const results: ServerProfile[] = new Array(servers.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= servers.length) break;
      results[idx] = await probeServer(servers[idx]);
    }
  }

  const concurrency = Math.min(MAX_CONCURRENT_PROBES, servers.length);
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
