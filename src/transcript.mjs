import { readFile } from "node:fs/promises";

const MARKER = /^NEXT:\s*(.+?)\s*$/gm;

export function extractNext(text) {
  // Guard the type, not just falsiness: a truthy non-string has no .matchAll.
  if (typeof text !== "string" || !text) return null;
  let last = null;
  for (const m of text.matchAll(MARKER)) {
    const value = m[1].trim();
    if (value) last = value;
  }
  return last;
}

// Claude Code writes the session transcript as JSON Lines. Unreadable or
// malformed transcripts are not an error: they mean "no marker", which the
// dispatcher treats as route-complete.
export async function readLastAssistantText(transcriptPath) {
  let raw;
  try {
    raw = await readFile(transcriptPath, "utf8");
  } catch {
    return "";
  }
  let latest = "";
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    // JSON.parse("null") succeeds and yields null, so the type check has to
    // survive a line that is syntactically valid but structurally useless.
    // Dereferencing .type here is outside the try/catch above.
    if (!entry || typeof entry !== "object" || entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (typeof content === "string") latest = content;
    else if (Array.isArray(content)) {
      latest = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    }
  }
  return latest;
}
