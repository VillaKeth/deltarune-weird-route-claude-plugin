import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractNext, readLastAssistantText } from "../src/transcript.mjs";

test("extracts a NEXT marker", () => {
  assert.equal(extractNext("Done.\nNEXT: rewrite the auth module"), "rewrite the auth module");
});

test("uses the last marker when several appear", () => {
  assert.equal(extractNext("NEXT: first\nmore text\nNEXT: second"), "second");
});

test("returns null when there is no marker", () => {
  assert.equal(extractNext("All finished, nothing left to do."), null);
});

test("ignores an empty marker", () => {
  assert.equal(extractNext("NEXT:   "), null);
});

test("reads the last assistant message from a JSONL transcript", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  const path = join(dir, "t.jsonl");
  await writeFile(path, [
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "first" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "NEXT: go" }] } }),
  ].join("\n"));
  assert.equal(await readLastAssistantText(path), "NEXT: go");
});

test("returns empty string when the transcript is unreadable", async () => {
  assert.equal(await readLastAssistantText("/nope/missing.jsonl"), "");
});
