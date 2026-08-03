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

// Regressions. This module's whole contract is that it never throws: the
// caller reads a throw as a crashed hook, which breaks the live session.
test("a structurally useless but syntactically valid line does not throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  for (const [name, junk] of [["null", "null"], ["number", "42"], ["string", '"oops"'], ["array", "[1,2]"]]) {
    const path = join(dir, `${name}.jsonl`);
    await writeFile(path, `${JSON.stringify({ type: "assistant", message: { content: "hi" } })}\n${junk}`);
    assert.equal(await readLastAssistantText(path), "hi", `a bare ${name} line broke the reader`);
  }
});

test("extractNext survives a non-string argument", () => {
  for (const junk of [42, true, [], {}, null, undefined]) {
    assert.equal(extractNext(junk), null, `extractNext(${JSON.stringify(junk)}) should be null`);
  }
});
