import { readFile, open, stat } from "node:fs/promises";

// Only the LAST assistant entry is ever used, so reading the whole file is
// waste that turns into a failure on a long session: Claude Code transcripts
// reach hundreds of megabytes, and readFile+split allocates the file twice over
// — once as a string, once as an unbounded array of lines. An OOM there kills
// the hook, and a dead PreToolUse hook fails open. 512 KB holds far more than
// one entry; the first (possibly partial) line of the window is discarded.
export const TAIL_BYTES = 512 * 1024;

const readTail = async (path) => {
  const { size } = await stat(path);
  if (size <= TAIL_BYTES) return readFile(path, "utf8");

  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(TAIL_BYTES);
    const { bytesRead } = await handle.read(buf, 0, TAIL_BYTES, size - TAIL_BYTES);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    // Drop the leading fragment — it is the tail of a line we cut in half, and
    // may also be a partial UTF-8 sequence.
    const nl = text.indexOf("\n");
    return nl === -1 ? "" : text.slice(nl + 1);
  } finally {
    await handle.close();
  }
};

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
    raw = await readTail(transcriptPath);
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
      // Blocks are guarded the same way entries are: a null or non-object
      // block would make `.type` and `.text` unguarded dereferences, and
      // nothing here is inside a try/catch.
      latest = content
        .filter((b) => b && typeof b === "object" && b.type === "text")
        .map((b) => (typeof b.text === "string" ? b.text : ""))
        .join("\n");
    }
  }
  return latest;
}
