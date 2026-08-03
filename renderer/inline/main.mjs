// The inline renderer: the same box, drawn in the terminal Claude Code is
// already running in.
//
// Implements the contract src/renderer-client.mjs speaks — one JSON job in on
// stdin, one {"choice":...} out on stdout, exit 0 — so it is a drop-in
// alternative to renderer/popup with no change to src/.
//
// It rests on one measured fact: a process whose stdio is piped can still open
// the real console. On Windows that is \\.\CONOUT$ and \\.\CONIN$; on POSIX
// /dev/tty. No PTY, no wrapper process, no native dependency — the design this
// replaced needed all three.
//
// Two details cost a probe each and are not guessable:
//   * CONIN$ must be opened "r+". setRawMode calls SetConsoleMode, which needs
//     write access; a read-only handle fails with EPERM.
//   * A data listener on a COOKED console blocks the event loop on a line read
//     that never returns. Raw mode first, listener second — in that order the
//     failsafe timer still fires. Verified both ways.
//
// This file holds only I/O, timers and teardown. What the box IS lives in
// src/scene.mjs and src/frame.mjs, where the tests can reach it.
import { openSync, closeSync, readSync, writeSync, existsSync, appendFileSync } from "node:fs";
import { ReadStream } from "node:tty";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "../../src/png.mjs";
import { halfBlocks } from "../../src/sprite.mjs";
import { buildFrame } from "../../src/frame.mjs";
import { decodeKeys } from "../../src/keys.mjs";
import { initialState, applyKey, tick, place } from "../../src/scene.mjs";
import { CRAWL_MS } from "../../src/nav.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "..", "assets");

const WIN = process.platform === "win32";
const OUT_PATH = WIN ? "\\\\.\\CONOUT$" : "/dev/tty";
const IN_PATH = WIN ? "\\\\.\\CONIN$" : "/dev/tty";

// renderer-client kills this process with SIGKILL at 120 s, and SIGKILL cannot
// be caught — a process killed mid-scene never restores the terminal, leaving
// the caller inside the alternate screen with raw input. The margin exists so
// our own teardown always wins that race.
const FAILSAFE_MS = Number(process.env.WEIRD_ROUTE_FAILSAFE_MS) || 110_000;

// Test seams, both inert in production. KEYS can manufacture a Proceed with no
// console involved, which is a working bypass of the whole gate, so it is
// locked behind the same explicit flag the popup uses. CAPTURE only redirects
// drawing, and cannot decide anything by itself.
const devSeams = process.env.WEIRD_ROUTE_DEV === "1";
const CAPTURE = process.env.WEIRD_ROUTE_INLINE_CAPTURE || "";
const SCRIPTED = devSeams ? (process.env.WEIRD_ROUTE_KEYS || "") : "";
if (!devSeams && process.env.WEIRD_ROUTE_KEYS) {
  try { writeSync(2, "WEIRD_ROUTE_KEYS ignored: set WEIRD_ROUTE_DEV=1 to enable it\n"); } catch { /* stderr is ignored by the caller */ }
}

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_OFF = "\x1b[?25l";
const CURSOR_ON = "\x1b[?25h";
const CLEAR = "\x1b[2J";
const at = (row, col) => `\x1b[${row};${col}H`;

let out = null;
let input = null;
let rawMode = false;
let answered = false;

function restore() {
  try { if (rawMode && input) input.setRawMode(false); } catch { /* best effort */ }
  rawMode = false;
  try { if (out !== null) writeSync(out, CURSOR_ON + ALT_OFF); } catch { /* best effort */ }
  try { input?.destroy(); } catch { /* already gone */ }
  try { if (out !== null) closeSync(out); } catch { /* already closed */ }
  out = null;
  input = null;
}
process.on("exit", restore);

// The decision reaches stdout before the terminal is put back, for the same
// reason the gate flushes before it saves state: every remaining step can
// throw, and a computed-but-undelivered decision is a fail-open.
function finish(choice) {
  if (answered) return;
  answered = true;
  try {
    writeSync(1, JSON.stringify({ choice: choice === "proceed" ? "proceed" : "refuse" }));
  } catch { /* a silent renderer is treated as a refusal by the caller */ }
  restore();
  process.exit(0);
}

// A synchronous pause, so an empty non-blocking pipe is waited on rather than
// spun on. setTimeout cannot help here: this runs before the event loop gets a
// turn, which is the whole reason the read is synchronous.
const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { /* SharedArrayBuffer unavailable: fall through and spin */ }
};

// The failsafe timer cannot rescue this — it is armed afterwards, and a
// synchronous read never yields to the event loop anyway. So the deadline is
// enforced here, in the same loop that can block.
const READ_DEADLINE_MS = 10_000;

function readJob() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  const deadline = Date.now() + READ_DEADLINE_MS;
  let size = 0;
  for (;;) {
    if (Date.now() > deadline) return null;   // a caller that never speaks refuses
    let n;
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e?.code === "EAGAIN") { sleepSync(5); continue; }
      if (e?.code === "EOF") break;
      return null;
    }
    if (n === 0) break;
    size += n;
    if (size > 1_000_000) return null;      // a job that size is a malfunction
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

// The terminal's size, asked of the terminal itself. process.stdout.columns is
// undefined here — stdout is a pipe to the gate, not the screen — so the size
// is queried with a cursor-position report: park the cursor past any plausible
// edge, ask where it actually landed, and that is the size.
function probeSize(timeoutMs = 300) {
  return new Promise((resolve) => {
    const fallback = { cols: 80, rows: 24 };
    let done = false;
    const settle = (size) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      input.off("data", onData);
      resolve(size);
    };
    const timer = setTimeout(() => settle(fallback), timeoutMs);

    let seen = "";
    const onData = (chunk) => {
      seen += chunk.toString("utf8");
      const m = /\x1b\[(\d+);(\d+)R/.exec(seen);
      if (m) settle({ rows: Number(m[1]), cols: Number(m[2]) });
    };
    input.on("data", onData);

    try {
      writeSync(out, "\x1b7\x1b[999;999H\x1b[6n\x1b8");
    } catch {
      settle(fallback);
    }
  });
}

function loadFace(name, divisor) {
  if (!name || !divisor) return [];
  const png = join(ASSETS, "noelle", `${name}.png`);
  if (!existsSync(png)) return [];
  try {
    return halfBlocks(decodePng(png), { divisor });
  } catch {
    return [];        // a damaged sprite draws an empty slot, never a crash
  }
}

async function main() {
  const job = readJob();
  if (!job || typeof job !== "object" || !Array.isArray(job.lines)) return finish("refuse");

  // Armed before the first thing that can block.
  setTimeout(() => finish("refuse"), FAILSAFE_MS);

  const headless = CAPTURE !== "";
  let term = { cols: 80, rows: 24 };

  if (!headless) {
    try {
      out = openSync(OUT_PATH, "w");
    } catch {
      return finish("refuse");            // no console to draw on
    }
    try {
      input = new ReadStream(openSync(IN_PATH, "r+"));   // "r+": setRawMode needs write
      input.setRawMode(true);                            // raw BEFORE any listener
      rawMode = true;
    } catch {
      return finish("refuse");            // no way to read an answer is a refusal
    }
    term = await probeSize();
  }

  const { box, origin } = place(job, term);
  const faceRows = loadFace(job.face, box.divisor);
  let state = initialState(job);

  const emit = (frame) => {
    if (headless) {
      try { appendFileSync(CAPTURE, frame.join("\n") + "\n\u0000\n"); } catch { /* capture is diagnostic */ }
      return;
    }
    let paint = "";
    for (let i = 0; i < frame.length; i++) paint += at(origin.row + i, origin.col) + frame[i];
    try { writeSync(out, paint); } catch { /* a failed repaint is not a decision */ }
  };

  const repaint = () => emit(buildFrame(job, state, box, faceRows));

  if (!headless) {
    try { writeSync(out, ALT_ON + CURSOR_OFF + CLEAR); } catch { return finish("refuse"); }
  }
  repaint();

  // Claude Code owns this screen and repaints it whenever it pleases — the
  // probe that proved the console was reachable had its banner overwritten
  // within milliseconds. Rather than fight for exclusivity, the box redraws
  // faster than it can be clobbered.
  const timers = [];
  if (!headless) timers.push(setInterval(repaint, 100));

  timers.push(setInterval(() => {
    if (state.revealed >= state.total) return;
    state = tick(state);
    repaint();
  }, CRAWL_MS));

  const stop = () => timers.forEach(clearInterval);

  const press = (key) => {
    const next = applyKey(state, key);
    state = next.state;
    if (next.answer) { stop(); finish(next.answer); return true; }
    if (next.changed) repaint();
    return false;
  };

  if (SCRIPTED) {
    // Keys are replayed through exactly the path a real keypress takes.
    for (const key of decodeKeys(SCRIPTED)) if (press(key)) return;
    stop();
    return finish("refuse");      // a script that never answers still refuses
  }

  // Headless with no script has nothing that can ever answer it.
  if (headless) { stop(); return finish("refuse"); }

  input.on("data", (chunk) => {
    for (const key of decodeKeys(chunk.toString("utf8"))) if (press(key)) return;
  });
  input.on("error", () => { stop(); finish("refuse"); });
}

main().catch(() => finish("refuse"));
