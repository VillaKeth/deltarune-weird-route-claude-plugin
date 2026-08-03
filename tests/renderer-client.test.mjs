import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { askUser, RENDER_TIMEOUT_MS } from "../src/renderer-client.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-renderer.mjs", import.meta.url));
const job = { kind: "gate", face: "trance", lines: ["* hi"], options: ["Proceed", "Refuse"], default: 0, sfx: null };
const run = (mode, timeoutMs) =>
  askUser(job, { command: process.execPath, args: [FAKE, mode], timeoutMs });

test("the timeout default is 120 seconds", () => {
  assert.equal(RENDER_TIMEOUT_MS, 120_000);
});

test("a proceed answer comes back as proceed", async () => {
  assert.equal(await run("proceed"), "proceed");
});

test("a refuse answer comes back as refuse", async () => {
  assert.equal(await run("refuse"), "refuse");
});

test("a crashed renderer fails closed", async () => {
  assert.equal(await run("crash"), "refuse");
});

test("garbage on stdout fails closed", async () => {
  assert.equal(await run("garbage"), "refuse");
});

test("an unknown choice value fails closed", async () => {
  assert.equal(await run("bogus-choice"), "refuse");
});

test("a missing renderer binary fails closed", async () => {
  assert.equal(await askUser(job, { command: "definitely-not-a-real-binary-xyz", args: [] }), "refuse");
});

test("a hung renderer is killed and fails closed", async () => {
  assert.equal(await run("hang", 300), "refuse");
});

// Regression. A renderer that exits before draining stdin makes the write fail
// asynchronously; streams surface that as an "error" event, which no try/catch
// around .end() can see. Unhandled it is an uncaught exception that takes the
// whole hook process down — and a crashed PreToolUse hook fails OPEN.
test("a renderer that exits without reading stdin does not crash the process", async () => {
  const big = { ...job, lines: Array(60_000).fill("* padding line") };
  assert.equal(
    await askUser(big, { command: process.execPath, args: [FAKE, "proceed"] }),
    "proceed",
  );
});

test("a huge payload to a crashing renderer still fails closed", async () => {
  const big = { ...job, lines: Array(60_000).fill("* padding line") };
  assert.equal(
    await askUser(big, { command: process.execPath, args: [FAKE, "crash"] }),
    "refuse",
  );
});
