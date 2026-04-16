import { distance } from "fastest-levenshtein";
import type { ServerProfile, Collision } from "./types.js";

/**
 * Maximum Levenshtein edit distance to qualify as a "similar" (fuzzy) collision.
 * Pairs beyond this distance are unlikely to confuse an LLM into selecting the
 * wrong tool and are excluded from the report.
 */
const MAX_LEVENSHTEIN_DISTANCE = 4;

/**
 * Minimum normalised similarity (1 - dist/maxLen) required alongside the
 * distance cap.  Prevents short pairs with large edits from being reported
 * (e.g. "ls" and "mv" have distance 2 but similarity 0.0).
 */
const MIN_SIMILARITY = 0.6;

export function detectCollisions(profiles: ServerProfile[]): Collision[] {
  const collisions: Collision[] = [];

  // --- Exact collisions ---------------------------------------------------
  // Build a map from tool name to every server that exposes it.
  const toolMap = new Map<string, string[]>();

  for (const profile of profiles) {
    for (const tool of profile.tools) {
      const servers = toolMap.get(tool.name) ?? [];
      servers.push(profile.name);
      toolMap.set(tool.name, servers);
    }
  }

  const exactNames = new Set<string>();

  for (const [toolName, servers] of toolMap) {
    if (servers.length < 2) continue;
    exactNames.add(toolName);

    // Suggestion: the config-level fix is to rename the server key; the
    // protocol-level fix is to rename the tool in the server's source code.
    const suggestion = servers
      .slice(1)
      .map((s) => `run --fix to rename "${s}" server key, or rename tool in ${s}'s source`)
      .join("; ");

    collisions.push({ toolName, servers, type: "exact", suggestion });
  }

  // --- Fuzzy collisions ---------------------------------------------------
  // Compare every cross-server tool name pair for near-matches.
  const allTools: { name: string; server: string }[] = [];
  for (const profile of profiles) {
    for (const tool of profile.tools) {
      allTools.push({ name: tool.name, server: profile.name });
    }
  }

  // Canonical pair key (sorted) prevents reporting (A,B) and (B,A) separately.
  const checked = new Set<string>();

  for (let i = 0; i < allTools.length; i++) {
    for (let j = i + 1; j < allTools.length; j++) {
      const a = allTools[i];
      const b = allTools[j];

      if (a.server === b.server) continue;
      if (exactNames.has(a.name) && a.name === b.name) continue;

      const pairKey = [a.name, b.name].sort().join("::");
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);

      if (a.name === b.name) continue; // exact match already handled above

      const dist = distance(a.name, b.name);
      const maxLen = Math.max(a.name.length, b.name.length);
      // Store the raw ratio; display code rounds for presentation.
      const similarity = 1 - dist / maxLen;

      if (dist <= MAX_LEVENSHTEIN_DISTANCE && similarity >= MIN_SIMILARITY) {
        collisions.push({
          toolName: `${a.name} ~ ${b.name}`,
          servers: [a.server, b.server],
          type: "similar",
          similarity,
          suggestion: `Near-identical names risk LLM misrouting -- consider namespacing: ${a.server}_${a.name}, ${b.server}_${b.name}`,
        });
      }
    }
  }

  return collisions;
}
