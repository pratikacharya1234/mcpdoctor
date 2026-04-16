export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPConfig {
  source: string;
  path: string;
  servers: MCPServerConfig[];
}

export interface ServerProfile {
  name: string;
  tools: MCPTool[];
  /** Elapsed time from process spawn through the first tools/list response. */
  coldStartMs: number;
  /** Mean round-trip time of subsequent tools/list calls (steady-state RTT). Zero when the server errored before warm sampling. */
  warmLatencyMs: number;
  status: "healthy" | "slow" | "error" | "timeout";
  error?: string;
}

export interface Collision {
  toolName: string;
  servers: string[];
  type: "exact" | "similar";
  similarity?: number;
  suggestion?: string;
}

export interface ContextEstimate {
  totalTools: number;
  estimatedTokens: number;
  tokenBudget: number;
  usagePercent: number;
  riskLevel: "low" | "moderate" | "high" | "critical";
  remainingCapacity: number;
  /** Mean tokens per tool, derived from actual tool definitions. Used for capacity projection. */
  avgTokensPerTool: number;
}

export interface DoctorReport {
  configs: MCPConfig[];
  profiles: ServerProfile[];
  collisions: Collision[];
  context: ContextEstimate;
  timestamp: string;
}
