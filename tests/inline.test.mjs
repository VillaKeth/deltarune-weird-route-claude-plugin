import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeKeys } from "../src/keys.mjs";
import { initialState, applyKey, tick, place } from "../src/scene.mjs";
import { buildFrame } from "../src/frame.mjs";
import { layout, OPTION_COL, SOUL_GAP_COLS, TEXT_COLS, PAD } from "../src/cells.mjs";
import { stripAnsi, halfBlocks } from "../src/sprite.mjs";
import { BOX, MAX_CHARS } from "../src/geometry.mjs";

const JOB = {
  kind: "gate", face: "trance",
  lines: ["* it wants to run", "  npm test"],
  options: ["Proceed", "Refuse"], default: 0, sfx: null,
};
const BIG = { cols: 120, rows: 45 };

// ------------------------------------------------------------------ key decoding

test("arrow keys arrive as CSI sequences and decode to nav's names", () => {
  assert.deepEqual(decodeKeys("\x1b[C"), ["ArrowRight"]);
  assert.deepEqual(decodeKeys("\x1b[D"), ["ArrowLeft"]);
  assert.deepEqual(decodeKeys("\x1b[C\x1b[D"), ["ArrowRight", "ArrowLeft"]);
});

test("a size report is swallowed whole, not read as keypresses", () => {
  // The terminal answers the size query with ESC[45;120R. Letting those bytes
  // fall through would deliver "R" — and, worse, the digits — as keys, and a
  // stray key at beat 2 is an answer.
  assert.deepEqual(decodeKeys("\x1b[45;120R"), []);
  assert.deepEqual(decodeKeys("\x1b[45;120Rz"), ["z"]);
});

test("Escape, Enter and Ctrl-C all decode to something that refuses", () => {
  assert.deepEqual(decodeKeys("\x1b"), ["Escape"]);
  assert.deepEqual(decodeKeys("\r"), ["Enter"]);
  assert.deepEqual(decodeKeys("\x03"), ["Escape"]);
});

test("decodeKeys never throws, whatever arrives", () => {
  for (const input of [null, undefined, 42, "", "\x1b[", "\x1b[999", "\x1b"]) {
    assert.doesNotThrow(() => decodeKeys(input), `threw on ${JSON.stringify(input)}`);
  }
});

// ---------------------------------------------------------------- the reducer

const run = (job, keys) => {
  let state = initialState(job);
  for (const key of keys) {
    const next = applyKey(state, key);
    state = next.state;
    if (next.answer) return { state, answer: next.answer };
  }
  return { state, answer: null };
};

test("Z skips the crawl, then advances to the choice, then confirms", () => {
  const first = applyKey(initialState(JOB), "z");
  assert.equal(first.state.revealed, first.state.total, "the first Z skips the crawl");
  assert.equal(first.state.beat, 1);

  const second = applyKey(first.state, "z");
  assert.equal(second.state.beat, 2, "the second Z advances to the choice");

  const third = applyKey(second.state, "z");
  assert.equal(third.answer, "proceed");
});

test("the soul moves right and confirms Refuse", () => {
  assert.equal(run(JOB, ["z", "z", "ArrowRight", "z"]).answer, "refuse");
});

test("the soul clamps at the ends rather than wrapping", () => {
  const { state } = run(JOB, ["z", "z", "ArrowRight", "ArrowRight", "ArrowRight"]);
  assert.equal(state.cursor, JOB.options.length - 1);
  const back = run(JOB, ["z", "z", "ArrowLeft", "ArrowLeft"]);
  assert.equal(back.state.cursor, 0);
});

test("X returns to her line with the soul where it was left", () => {
  const { state } = run(JOB, ["z", "z", "ArrowRight", "x"]);
  assert.equal(state.beat, 1);
  assert.equal(state.cursor, 1, "the cursor survives going back");
});

test("Escape refuses from any beat", () => {
  assert.equal(run(JOB, ["Escape"]).answer, "refuse");
  assert.equal(run(JOB, ["z", "z", "Escape"]).answer, "refuse");
});

test("the route-complete box is dismissed by Z, and dismissing is not a proceed", () => {
  const done = { kind: "complete", face: "speechless", lines: ["* ...it's done, Kris."],
                 options: [], default: 0, sfx: null };
  assert.equal(run(done, ["z"]).answer, "refuse");
});

test("applyKey fails closed on damaged state rather than throwing", () => {
  for (const bad of [null, undefined, 42, "nope"]) {
    const out = applyKey(bad, "z");
    assert.equal(out.answer, "refuse", `state ${JSON.stringify(bad)} did not refuse`);
  }
});

test("an empty options list refuses on Z instead of reading an undefined label", () => {
  const empty = { ...JOB, options: [] };
  const { answer } = run(empty, ["z", "z", "z"]);
  assert.equal(answer, "refuse");
});

test("tick stops at the end of her line", () => {
  let state = initialState(JOB);
  for (let i = 0; i < state.total + 20; i++) state = tick(state);
  assert.equal(state.revealed, state.total);
});

// ------------------------------------------------------------------- the frame

const render = (job, state, term = BIG) => {
  const { box } = place(job, term);
  return buildFrame(job, state, box, []).map(stripAnsi);
};

test("every row of the box is exactly the declared width", () => {
  const { box } = place(JOB, BIG);
  const rows = render(JOB, { ...initialState(JOB), revealed: 999 });
  for (const row of rows) {
    assert.equal(row.length, box.width, `row "${row}" is ${row.length}, not ${box.width}`);
  }
  assert.equal(rows.length, box.height);
});

test("beat 2 is its own screen: her line is gone, only the choice remains", () => {
  const state = { ...initialState(JOB), revealed: 999, beat: 2 };
  const text = render(JOB, state).join("\n");
  assert.ok(text.includes("Proceed"), "the choice must show");
  assert.ok(!text.includes("it wants to run"),
    "her line is still on screen at beat 2 — the two beats are sharing the box");
});

test("she is not on the choice screen either, and the box keeps its size", () => {
  const { box } = place(JOB, BIG);
  // A stand-in sprite, so its presence or absence is unmistakable in the text.
  const faceRows = Array.from({ length: box.faceRows }, () => "N".repeat(box.faceCols));

  const speaking = buildFrame(JOB, { ...initialState(JOB), revealed: 999 }, box, faceRows);
  const choosing = buildFrame(JOB, { ...initialState(JOB), revealed: 999, beat: 2 }, box, faceRows);

  assert.ok(speaking.join("").includes("N"), "she should be drawn while she speaks");
  assert.ok(!choosing.join("").includes("N"), "the portrait is still drawn on the choice screen");

  // The slot stays reserved: a box that changed width between beats would jump.
  assert.equal(choosing.length, speaking.length);
  for (let i = 0; i < choosing.length; i++) {
    assert.equal(stripAnsi(choosing[i]).length, stripAnsi(speaking[i]).length,
      `row ${i} changed width when she left`);
  }
});

test("beat 1 shows her line and no choice", () => {
  const state = { ...initialState(JOB), revealed: 999 };
  const text = render(JOB, state).join("\n");
  assert.ok(text.includes("it wants to run"));
  assert.ok(!text.includes("Proceed"), "the choice showed a beat early");
});

test("the crawl reveals her line one character at a time, across the line break", () => {
  const at = (n) => render(JOB, { ...initialState(JOB), revealed: n }).join("\n");
  assert.ok(!at(0).includes("*"), "nothing is revealed at zero");
  assert.ok(at(4).includes("* it"), "the first row reveals progressively");
  assert.ok(!at(4).includes("npm"), "the second row waits its turn");
  assert.ok(at(999).includes("npm test"), "the whole line eventually shows");
});

test("the soul sits to the left of the option it points at, and moves with it", () => {
  const rows = (cursor) =>
    render(JOB, { ...initialState(JOB), revealed: 999, beat: 2, cursor });

  const findSoul = (rendered) => {
    for (const row of rendered) {
      const i = row.indexOf("♥");
      if (i !== -1) return { row, i };
    }
    return null;
  };

  const left = findSoul(rows(0));
  const right = findSoul(rows(1));
  assert.ok(left && right, "the soul must be drawn at both positions");
  assert.ok(right.i > left.i, "the soul did not move right with the cursor");

  // It points at its label from SOUL_GAP_COLS to the left.
  assert.equal(left.row.indexOf("Proceed") - left.i, SOUL_GAP_COLS);
  assert.equal(right.row.indexOf("Refuse") - right.i, SOUL_GAP_COLS);
});

test("the choice is centred in the box, not left in the vacated text column", () => {
  // The text area is offset right to clear the portrait, and the portrait is
  // not on this screen. Leaving the choice there stranded it against the right
  // edge of an otherwise empty box.
  const { box } = place(JOB, BIG);
  const rendered = render(JOB, { ...initialState(JOB), revealed: 999, beat: 2, cursor: 0 });
  const row = rendered.find((r) => r.includes("Proceed"));
  assert.ok(row, "the choice must be drawn");

  const first = row.indexOf("♥");
  const last = row.indexOf("Refuse") + "Refuse".length;
  const slack = Math.abs((first - 1) - (box.width - 1 - last));
  assert.ok(slack <= 2, `the choice is off-centre: ${first - 1} left, ${box.width - 1 - last} right`);
  assert.ok(first < box.textCol,
    `the choice starts at ${first}, still inside the text column at ${box.textCol}`);
});

test("a job whose lines overflow the box is clipped, not spilled", () => {
  const flood = { ...JOB, lines: ["x".repeat(500), "y".repeat(500), "z".repeat(500), "w".repeat(500)] };
  const { box } = place(flood, BIG);
  for (const row of buildFrame(flood, { ...initialState(flood), revealed: 99999 }, box, []).map(stripAnsi)) {
    assert.equal(row.length, box.width, "a long line changed the width of the box");
  }
});

test("buildFrame never throws on a malformed job", () => {
  const { box } = place(JOB, BIG);
  for (const job of [{}, { lines: null }, { lines: ["ok"], options: null },
                     { lines: [1, 2, 3], options: ["Proceed"] }]) {
    assert.doesNotThrow(
      () => buildFrame(job, initialState(job), box, []), `threw on ${JSON.stringify(job)}`);
  }
});

// ------------------------------------------------------------------ the layout

test("the option columns are derived from the declared pixel positions", () => {
  // Not restated: the pixel X of each label, less where the text starts,
  // divided by the character advance.
  assert.equal(OPTION_COL.Proceed, Math.round((91 - BOX.textX.withPortrait) / BOX.advance));
  assert.ok(OPTION_COL.Refuse > OPTION_COL.Proceed);
  assert.ok(OPTION_COL.Refuse + "Refuse".length <= TEXT_COLS, "Refuse runs past the text area");
  assert.equal(TEXT_COLS, MAX_CHARS.withPortrait);
});

test("the sprite shrinks by whole numbers until the box fits the terminal", () => {
  const wide = layout({ cols: 200, rows: 50 });
  assert.equal(wide.divisor, 1, "a large terminal should show her at full size");
  assert.equal(wide.faceCols, BOX.face.w);

  const narrow = layout({ cols: 70, rows: 20 });
  assert.ok(narrow.divisor >= 2, `a 70-column terminal got divisor ${narrow.divisor}`);
  assert.ok(narrow.width <= 70, `box is ${narrow.width} wide in a 70-column terminal`);
  assert.ok(narrow.height <= 20, `box is ${narrow.height} tall in a 20-row terminal`);
});

test("a terminal too small for a legible sprite drops it rather than smudging it", () => {
  // Without a floor on the divisor the search returns 56, which "fits" by
  // arithmetic: a one-cell portrait. She is dropped instead, and the text —
  // the part that carries the actual decision — keeps its full width.
  const tiny = layout({ cols: 34, rows: 6 });
  assert.equal(tiny.faceCols, 0, "a one-cell face was claimed to fit");
  assert.equal(tiny.width, 2 + PAD * 2 + TEXT_COLS, `box is ${tiny.width} wide with no sprite`);
  assert.ok(tiny.width <= 34);
});

test("the half-block sprite keeps two source pixels per cell row", () => {
  const img = { w: 8, h: 8, px: (x, y) => ({ r: x * 30, g: y * 30, b: 0, a: 255 }) };
  const rows = halfBlocks(img, { divisor: 1 });
  assert.equal(rows.length, 4, "8 source rows must become 4 cell rows");
  assert.equal(stripAnsi(rows[0]).length, 8);
});

test("a fully transparent sprite falls back to the background, not to noise", () => {
  const img = { w: 4, h: 4, px: () => ({ r: 255, g: 0, b: 0, a: 0 }) };
  const rows = halfBlocks(img, { divisor: 1 });
  assert.ok(!rows.join("").includes("255;0;0"), "transparent pixels drew their colour");
});

// ---------------------------------------------------------------------- end to end

const ROOT = join(import.meta.dirname, "..");
let seq = 0;

const runRenderer = (job, keys, extraEnv = {}) => new Promise((resolve) => {
  const capture = join(tmpdir(), `weird-inline-${process.pid}-${seq++}.txt`);
  const child = spawn(process.execPath, [join(ROOT, "renderer", "inline", "main.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      WEIRD_ROUTE_DEV: "1",
      WEIRD_ROUTE_KEYS: keys,
      WEIRD_ROUTE_INLINE_CAPTURE: capture,
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  child.on("close", (code) => {
    const frames = existsSync(capture) ? readFileSync(capture, "utf8") : "";
    rmSync(capture, { force: true });
    resolve({ out, err, code, frames });
  });
  child.stdin.end(JSON.stringify(job));
});

test("the renderer answers proceed through the real key path", async () => {
  const { out, code } = await runRenderer(JOB, "zzz");
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { choice: "proceed" });
});

test("the renderer answers refuse when the soul is moved to Refuse", async () => {
  const { out } = await runRenderer(JOB, "zz\x1b[Cz");
  assert.deepEqual(JSON.parse(out), { choice: "refuse" });
});

test("a script that never answers still refuses", async () => {
  const { out } = await runRenderer(JOB, "z");
  assert.deepEqual(JSON.parse(out), { choice: "refuse" });
});

test("a malformed job refuses without drawing anything", async () => {
  const child = spawn(process.execPath, [join(ROOT, "renderer", "inline", "main.mjs")], {
    cwd: ROOT,
    env: { ...process.env, WEIRD_ROUTE_INLINE_CAPTURE: join(tmpdir(), "weird-never.txt") },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let out = "";
  child.stdout.on("data", (c) => (out += c));
  child.stdin.end("not json at all");     // before the await: the renderer waits for EOF
  const code = await new Promise((r) => child.on("close", r));
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { choice: "refuse" });
});

test("the scripted-keys seam is inert without the explicit dev flag", async () => {
  // It can manufacture a Proceed with no console and no user, which is a
  // working bypass of the entire gate.
  const { out, err } = await runRenderer(JOB, "zzz", { WEIRD_ROUTE_DEV: "" });
  assert.deepEqual(JSON.parse(out), { choice: "refuse" });
  assert.match(err, /WEIRD_ROUTE_DEV/, "the ignored seam must announce itself");
});

test("the gate selects the inline renderer, and it is plain Node", async () => {
  // WEIRD_ROUTE_INLINE_CAPTURE is set for the same reason a popup test once had
  // to be pinned: without it this spawns the real renderer, which takes over
  // the terminal running the suite. Headless, it can only refuse — which is
  // exactly what proves the gate reached it and honoured its answer.
  const capture = join(tmpdir(), `weird-gate-inline-${process.pid}.txt`);
  const stateDir = join(tmpdir(), `weird-gate-state-${process.pid}-${seq++}`);
  const child = spawn(process.execPath, [join(ROOT, "hooks", "gate.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      TEST_MODE: "1",
      WEIRD_ROUTE_RENDERER: "inline",
      WEIRD_ROUTE_INLINE_CAPTURE: capture,
      WEIRD_ROUTE_STATE_DIR: stateDir,
      WEIRD_ROUTE_DEV: "",
      WEIRD_ROUTE_KEYS: "",
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let out = "";
  child.stdout.on("data", (c) => (out += c));
  child.stdin.end(JSON.stringify({
    hook_event_name: "PreToolUse", session_id: "inline-select",
    tool_name: "Bash", tool_input: { command: "echo hi" },
  }));
  await new Promise((r) => child.on("close", r));

  rmSync(capture, { force: true });
  rmSync(stateDir, { recursive: true, force: true });

  const decision = JSON.parse(out);
  assert.equal(decision.hookSpecificOutput?.permissionDecision, "deny",
    "the gate did not honour the inline renderer's refusal");
});

test("the captured frames show the box the user would have seen", async () => {
  const { frames } = await runRenderer(JOB, "zzz");
  const plain = stripAnsi(frames);
  assert.ok(plain.includes("it wants to run"), "her line never drew");
  assert.ok(plain.includes("Proceed") && plain.includes("Refuse"), "the choice never drew");
});
