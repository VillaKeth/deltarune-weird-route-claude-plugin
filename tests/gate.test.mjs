// End-to-end tests for hooks/gate.mjs, driven as a real child process.
//
// gate.mjs is the only module with no unit surface: it is a script, not an
// export. It was previously verified only by ad-hoc controller probes that did
// not survive the session, which left the project's outermost fail-closed
// boundary as its least-tested file. These tests drive the real script over a
// real pipe, using WEIRD_ROUTE_RENDERER_CMD to stand in for Electron.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile, mkdir, readFile, rm, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "..", "hooks", "gate.mjs");
const FIXTURE = join(HERE, "fixtures", "fake-renderer.mjs");

// A temp directory, not the repo's real state/. These tests used to write
// session files alongside live ones and leave them behind, and a test id could
// in principle collide with a real session id.
const STATE_DIR = join(tmpdir(), `weird-gate-state-${process.pid}`);

// The override args are JSON precisely because FIXTURE's absolute path contains
// spaces on any normal checkout of this project.
const renderer = (mode) => ({
  WEIRD_ROUTE_DEV: "1",                 // stub seams are inert without this
  WEIRD_ROUTE_RENDERER_CMD: process.execPath,
  WEIRD_ROUTE_RENDERER_ARGS: JSON.stringify([FIXTURE, mode]),
});

const seed = async (id, state) => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(join(STATE_DIR, `${id}.json`), JSON.stringify(state), "utf8");
};

const stateOf = async (id) => {
  try { return JSON.parse(await readFile(join(STATE_DIR, `${id}.json`), "utf8")); }
  catch { return null; }
};

const run = (payload, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [GATE], {
      env: { ...process.env, WEIRD_ROUTE_STATE_DIR: STATE_DIR, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });

const cleanup = (id) => rm(join(STATE_DIR, `${id}.json`), { force: true });

const writeTranscript = async (name, text) => {
  const path = join(tmpdir(), `weird-gate-${name}-${process.pid}.jsonl`);
  await writeFile(path, JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  }) + "\n", "utf8");
  return path;
};

test("PreToolUse + Refuse denies the call and ends the route", async (t) => {
  const id = `test-gate-deny-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 0 });

  const r = await run(
    { hook_event_name: "PreToolUse", session_id: id, tool_name: "Write", tool_input: { file_path: "a/b.txt" } },
    renderer("refuse"));

  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "deny");
  assert.equal((await stateOf(id)).routeActive, false);
});

test("PreToolUse + Proceed allows the call and resets the counter", async (t) => {
  const id = `test-gate-allow-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 9 });

  const r = await run(
    { hook_event_name: "PreToolUse", session_id: id, tool_name: "Bash", tool_input: { command: "ls" } },
    renderer("proceed"));

  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "allow");
  const after = await stateOf(id);
  assert.equal(after.routeActive, true);
  assert.equal(after.autoContinues, 0);
});

test("a read-only tool never gates, even with the route active", async (t) => {
  const id = `test-gate-readonly-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 0 });

  const r = await run(
    { hook_event_name: "PreToolUse", session_id: id, tool_name: "Read", tool_input: { file_path: "a.txt" } },
    renderer("refuse"));

  assert.equal(r.code, 0);
  assert.equal(r.out, "", "a Read must produce no decision at all");
  assert.equal((await stateOf(id)).routeActive, true);
});

test("Stop carrying NEXT under the ceiling auto-continues without consulting the renderer", async (t) => {
  const id = `test-gate-next-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 3 });
  const transcript = await writeTranscript("next", "all done\nNEXT: keep refactoring");

  // The renderer is wired to REFUSE. If the auto-continue path consulted it, the
  // route would end and no block would be emitted — so a block here proves the
  // renderer was never asked.
  const r = await run(
    { hook_event_name: "Stop", session_id: id, transcript_path: transcript },
    renderer("refuse"));

  assert.deepEqual(JSON.parse(r.out), { decision: "block", reason: "keep refactoring" });
  const after = await stateOf(id);
  assert.equal(after.autoContinues, 4);
  assert.equal(after.routeActive, true);
});

test("Stop at the auto-continue ceiling forces the box, and Proceed resets it", async (t) => {
  const id = `test-gate-ceiling-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 25 });
  const transcript = await writeTranscript("ceiling", "still going\nNEXT: keep refactoring");

  const r = await run(
    { hook_event_name: "Stop", session_id: id, transcript_path: transcript },
    renderer("proceed"));

  assert.deepEqual(JSON.parse(r.out), { decision: "block", reason: "keep refactoring" });
  assert.equal((await stateOf(id)).autoContinues, 0);
});

test("Notification emits no decision either way — the hook has no decision control", async (t) => {
  const proceed = `test-gate-notif-p-${process.pid}`;
  const refuse = `test-gate-notif-r-${process.pid}`;
  t.after(() => Promise.all([cleanup(proceed), cleanup(refuse)]));

  await seed(proceed, { routeActive: true, autoContinues: 2 });
  const a = await run({ hook_event_name: "Notification", session_id: proceed }, renderer("proceed"));
  assert.equal(a.out, "");
  assert.equal((await stateOf(proceed)).routeActive, true, "Proceed leaves the route running");

  await seed(refuse, { routeActive: true, autoContinues: 2 });
  const b = await run({ hook_event_name: "Notification", session_id: refuse }, renderer("refuse"));
  assert.equal(b.out, "");
  assert.equal((await stateOf(refuse)).routeActive, false, "Refuse ends the route");
});

test("a renderer that exits non-zero denies rather than allowing", async (t) => {
  const id = `test-gate-crash-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 0 });

  const r = await run(
    { hook_event_name: "PreToolUse", session_id: id, tool_name: "Edit", tool_input: { file_path: "a.js" } },
    renderer("crash"));

  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "deny");
});

test("a renderer emitting garbage denies rather than allowing", async (t) => {
  const id = `test-gate-garbage-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 0 });

  const r = await run(
    { hook_event_name: "PreToolUse", session_id: id, tool_name: "Edit", tool_input: { file_path: "a.js" } },
    renderer("garbage"));

  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "deny");
});

test("an unresolvable renderer denies immediately instead of hanging", async (t) => {
  const id = `test-gate-norenderer-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 0 });

  // Point the entry at a file that does not exist, with no command override, so
  // the existsSync short-circuit is what is under test. Measured before that
  // check existed: Electron with a missing main does NOT exit, it hangs, and
  // the call took 121_105 ms to resolve against the 120 s timeout.
  //
  // This deliberately does NOT rely on renderer/popup/main.mjs being absent.
  // An earlier version did, and it silently became a 120 s hang the moment the
  // real renderer was written.
  const started = Date.now();
  const r = await run(
    { hook_event_name: "PreToolUse", session_id: id, tool_name: "Write", tool_input: { file_path: "a.txt" } },
    { WEIRD_ROUTE_RENDERER_CMD: "", WEIRD_ROUTE_RENDERER_ARGS: "",
      WEIRD_ROUTE_RENDERER_ENTRY: join(HERE, "fixtures", "no-such-renderer.mjs") });
  const elapsed = Date.now() - started;

  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "deny");
  assert.ok(elapsed < 30_000, `took ${elapsed}ms — a missing renderer must fail fast`);
});

test("garbage on stdin exits cleanly and denies rather than staying silent", async () => {
  // An unparseable payload might have been a PreToolUse. Silence sends that
  // tool call to the normal permission flow, which under bypassPermissions is
  // an allow — the exact fail-open this module exists to prevent.
  for (const payload of ["", "not json", "null", "42", '"a string"']) {
    const r = await run(payload, renderer("refuse"));
    assert.equal(r.code, 0, `payload ${JSON.stringify(payload)} exited ${r.code}`);
    assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "deny",
      `payload ${JSON.stringify(payload)} did not deny`);
  }
});

test("a Stop that cannot persist its counter withholds the block entirely", async (t) => {
  // The auto-continue counter is the ONLY bound on free-running. If the bump
  // cannot be written, the counter never advances, atLimit never trips, and
  // the 25-continue ceiling stops existing. Refusing to continue is the safe
  // direction, so the block must not be emitted at all.
  const id = `test-gate-blockperm-${process.pid}`;
  const file = join(STATE_DIR, `${id}.json`);
  t.after(async () => { await chmod(file, 0o666).catch(() => {}); await cleanup(id); });

  await seed(id, { routeActive: true, autoContinues: 3 });
  await chmod(file, 0o444);

  let readOnly = true;
  try { await writeFile(file, "x", "utf8"); readOnly = false; } catch { /* expected */ }
  if (!readOnly) return t.skip("filesystem ignores the read-only bit here");

  const transcript = await writeTranscript("blockperm", "ok\nNEXT: keep refactoring");
  const r = await run({ hook_event_name: "Stop", session_id: id, transcript_path: transcript },
                      renderer("refuse"));

  assert.equal(r.code, 0);
  assert.equal(r.out, "", "an uncountable auto-continue must not be granted");
  assert.equal((await stateOf(id)).autoContinues, 3, "the counter did not move");
});

test("the NEXT: convention is pushed to the model while the route is live", async (t) => {
  // Nothing else instructs it. Without this the marker never appears, every
  // turn end reads as route-complete, and the route dies after one turn.
  const id = `test-gate-instr-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 0 });

  const r = await run({ hook_event_name: "UserPromptSubmit", session_id: id, prompt: "carry on" },
                      renderer("refuse"));

  const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /NEXT:/, "the instruction must name the marker");
  assert.equal((await stateOf(id)).routeActive, true, "and must not disturb the route");
});

test("no instruction leaks into prompts while the route is off", async (t) => {
  const id = `test-gate-noinstr-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: false, autoContinues: 0 });

  const r = await run({ hook_event_name: "UserPromptSubmit", session_id: id, prompt: "hello" },
                      renderer("refuse"));
  assert.equal(r.out, "");
});

test("dev seams are inert without WEIRD_ROUTE_DEV", async (t) => {
  // WEIRD_ROUTE_RENDERER_CMD can manufacture a Proceed. Reachable through
  // Claude Code's settings `env` block, so one approved Write would otherwise
  // disable the gate permanently and silently.
  const id = `test-gate-seam-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 0 });

  // The entry points at a file that does not exist, which makes the two
  // branches of resolveRenderer distinguishable without ever opening a window:
  // if the override were honoured it returns first and the stub answers
  // "proceed"; if it is ignored, the missing entry short-circuits to a refusal.
  //
  // The first version of this test omitted the entry, so the fall-through
  // spawned a REAL Electron box on the developer's screen and sat there until
  // a stray keystroke answered it — which is also how it went green as "allow".
  // A test must never put a window in front of someone.
  const r = await run(
    { hook_event_name: "PreToolUse", session_id: id, tool_name: "Write", tool_input: { file_path: "a.txt" } },
    { WEIRD_ROUTE_RENDERER_CMD: process.execPath,
      WEIRD_ROUTE_RENDERER_ARGS: JSON.stringify([FIXTURE, "proceed"]),
      WEIRD_ROUTE_RENDERER_ENTRY: join(HERE, "fixtures", "no-such-renderer.mjs") });

  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "deny",
    "a stub renderer must not be able to force a Proceed without the dev flag");
});

test("a failing saveState still delivers the decision", async (t) => {
  const id = `test-gate-eperm-${process.pid}`;
  const file = join(STATE_DIR, `${id}.json`);
  t.after(async () => { await chmod(file, 0o666).catch(() => {}); await cleanup(id); });

  await seed(id, { routeActive: true, autoContinues: 7 });
  await chmod(file, 0o444);

  // Confirm the platform actually made it unwritable — otherwise this asserts
  // nothing. An earlier version of this probe passed for the wrong reason.
  let readOnly = true;
  try { await writeFile(file, "x", "utf8"); readOnly = false; } catch { /* expected */ }
  t.diagnostic(`state file read-only: ${readOnly}`);
  if (!readOnly) return t.skip("filesystem ignores the read-only bit here");

  const r = await run(
    { hook_event_name: "PreToolUse", session_id: id, tool_name: "Write", tool_input: { file_path: "a.txt" } },
    renderer("refuse"));

  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "deny",
    "the decision must reach stdout even when persisting it fails");
  assert.equal((await stateOf(id)).autoContinues, 7, "the counter is left stale, as designed");
});

test("override args survive a path containing spaces", async (t) => {
  const id = `test-gate-spaces-${process.pid}`;
  t.after(() => cleanup(id));
  await seed(id, { routeActive: true, autoContinues: 0 });

  // FIXTURE's real path contains spaces in this project. A space-split arg
  // parser silently turns it into several broken arguments, the child dies
  // "cannot find module", and the gate refuses for entirely the wrong reason —
  // a passing test that proves nothing.
  assert.ok(FIXTURE.includes(" "), "this test is only meaningful from a path with spaces");

  const r = await run(
    { hook_event_name: "PreToolUse", session_id: id, tool_name: "Write", tool_input: { file_path: "a.txt" } },
    renderer("proceed"));

  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "allow",
    "the fixture must actually run — a refuse here means the args were mangled");
});
