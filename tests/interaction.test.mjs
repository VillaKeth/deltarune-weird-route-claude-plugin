// Drives the real Electron window with real input events and asserts what it
// writes to stdout. src/nav.mjs proves the rules are right; this proves they
// are actually wired to the keyboard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const JOB = {
  kind: "gate", face: "trance",
  lines: ["* Kris... it wants to", "  rewrite 14 files."],
  options: ["Proceed", "Refuse"], default: 0, sfx: null,
};

// keyCode names are Electron's sendInputEvent vocabulary; before-input-event
// reports them as "z" / "ArrowRight" / "Escape".
const press = (keys, job = JOB, extraEnv = {}) => new Promise((resolve, reject) => {
  const electron = createRequire(import.meta.url)("electron");
  const child = spawn(electron, ["renderer/popup/main.mjs"], {
    env: { ...process.env, WEIRD_ROUTE_DEV: "1", WEIRD_ROUTE_KEYS: keys.join(","), WEIRD_ROUTE_CAPTURE: "", ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "", err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  const kill = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timed out; stderr=${err.slice(0, 300)}`)); }, 30_000);
  child.on("close", () => {
    clearTimeout(kill);
    try { resolve(JSON.parse(out).choice); }
    catch { reject(new Error(`unparseable stdout ${JSON.stringify(out)}; stderr=${err.slice(0, 300)}`)); }
  });
  child.stdin.end(JSON.stringify(job));
});

test("Escape refuses immediately, before any choice is even shown", async () => {
  assert.equal(await press(["Escape"]), "refuse");
});

test("Z skips the crawl, Z opens the choice, Z confirms Proceed", async () => {
  assert.equal(await press(["Z", "Z", "Z"]), "proceed");
});

test("moving the soul right and confirming refuses", async () => {
  assert.equal(await press(["Z", "Z", "Right", "Z"]), "refuse");
});

test("moving right then back left confirms Proceed again", async () => {
  assert.equal(await press(["Z", "Z", "Right", "Left", "Z"]), "proceed");
});

test("the soul clamps at the right end rather than wrapping to Proceed", async () => {
  assert.equal(await press(["Z", "Z", "Right", "Right", "Right", "Z"]), "refuse");
});

test("X returns to her line, and the soul is where it was left", async () => {
  // Z Z opens the choice, Right selects Refuse, X goes back to her line. The
  // following Z only re-opens the choice — it does not confirm — so the final
  // Z is what answers, and it answers on the remembered position.
  assert.equal(await press(["Z", "Z", "Right", "X", "Z", "Z"]), "refuse");

  // The same sequence without the X confirms one key earlier, which is what
  // makes the assertion above meaningful rather than incidental.
  assert.equal(await press(["Z", "Z", "Right", "Z"]), "refuse");
  assert.equal(await press(["Z", "Z", "X", "Z", "Z"]), "proceed");
});

test("the route-complete box is dismissed by Z and reports refuse", async () => {
  const done = { kind: "complete", face: "speechless", lines: ["* ...it's done, Kris."], options: [], default: 0, sfx: null };
  assert.equal(await press(["Z"], done), "refuse");
});

test("the failsafe force-closes and refuses with no key ever pressed", async () => {
  // The spec's hard teardown: an independent timer must resolve the window
  // regardless of state. Never ship a path where a bug leaves an un-closable
  // always-on-top window on someone's screen.
  const started = Date.now();
  assert.equal(await press([], JOB, { WEIRD_ROUTE_FAILSAFE_MS: "1500" }), "refuse");
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1400, `answered after ${elapsed}ms — the failsafe did not gate it`);
  assert.ok(elapsed < 15_000, `took ${elapsed}ms — the failsafe did not fire on time`);
});
