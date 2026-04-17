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
/** Hard cap on retained stderr bytes per probe — prevents unbounded RSS growth from chatty servers. */
const MAX_STDERR_BYTES = 4096;
/** Maximum stderr length included in error messages. */
const STDERR_SNIPPET_BYTES = 512;

async function fetchTools(client: Client): Promise<MCPTool[]> {
  const result = await client.listTools();
  return (result.tools as MCPTool[]).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown> | undefined,
  }));
}

export async function probeServer(config: MCPServerConfig): Promise<ServerProfile> {
  let transport: StdioClientTransport | undefined;
  let client: Client | undefined;
  let getStderr: () => string = () => "";
  const t0 = performance.now();

  try {
    // Transport is created *before* the timeout race so the timeout branch has
    // a handle to close the child process instead of orphaning it.
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      stderr: "pipe",
    });

    // Stderr is collected into a bounded buffer; once MAX_STDERR_BYTES is
    // reached further chunks are dropped so a misbehaving server cannot grow
    // RSS without bound during the probe window.
    const chunks: Buffer[] = [];
    let stderrBytes = 0;
    transport.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      const remaining = MAX_STDERR_BYTES - stderrBytes;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(slice);
      stderrBytes += slice.length;
    });
    getStderr = (): string =>
      Buffer.concat(chunks).toString("utf-8").trim().slice(0, STDERR_SNIPPET_BYTES);

    client = new Client(
      { name: "mcpdoctor", version: "0.1.0" },
      { capabilities: {} }
    );

    // Race connect against timeout — transport/client remain in scope so the
    // catch block can tear them down regardless of which side won.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error("Connection timeout")),
        PROBE_TIMEOUT_MS
      );
    });

    try {
      await Promise.race([client.connect(transport), timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    // Cold start: connection + first tools/list — what the user waits for on MCP client launch.
    const tools = await fetchTools(client);
    const coldStartMs = Math.round(performance.now() - t0);

    // Warm samples: subsequent tools/list calls with the connection already open.
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
    // client.close() closes the transport as well; null out to skip redundant close in finally.
    client = undefined;
    transport = undefined;

    const status: ServerProfile["status"] =
      coldStartMs > SLOW_COLD_MS || warmLatencyMs > SLOW_WARM_MS ? "slow" : "healthy";

    return { name: config.name, tools, coldStartMs, warmLatencyMs, status };
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    const base = err instanceof Error ? err.message : String(err);
    const stderr = getStderr();
    const errorDetail = stderr ? `${base} -- stderr: ${stderr}` : base;

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
  } finally {
    // Guaranteed cleanup: kill the child process on any exit path. client.close()
    // also closes the transport; we call transport.close() as a belt-and-braces
    // guard for the case where the client was created but never successfully connected.
    try { await client?.close(); } catch { /* already dead */ }
    try { await transport?.close(); } catch { /* already dead */ }
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
