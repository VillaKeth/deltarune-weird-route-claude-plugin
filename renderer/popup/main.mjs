// Electron main process for the Deltarune gate box. Reads a job on stdin,
// shows the box, and writes a single {"choice":"..."} to stdout. See
// src/renderer-client.mjs for the contract this process must honour: non-zero
// exit, malformed stdout, or a 120s timeout are all treated as "refuse".
//
// All interaction state lives here, not in the page. box.html can only load a
// classic script (Chromium refuses ES-module imports over file://), so nothing
// it loads can import src/ or be reached by node --test. Keeping the rules in
// src/nav.mjs and driving them from here makes the whole interaction testable
// and leaves the page a dumb painter.
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { writeFile, access } from "node:fs/promises";
import { readSync } from "node:fs";
import { BOX, rowY, OPTION_X, faceOffset } from "../../src/geometry.mjs";
import { keyAction, totalChars, CRAWL_MS } from "../../src/nav.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "..", "assets");
const SCALE = BOX.scale;

// Test-only capture mode. Also reveals the text instantly — a capture taken
// while the typewriter is still crawling would assert against a half-drawn row.
const CAPTURE = process.env.WEIRD_ROUTE_CAPTURE;

if (CAPTURE) {
  // Capturing a transparent, always-on-top window through the GPU compositor
  // fails with UnknownVizError on Windows.
  app.disableHardwareAcceleration();
  // capturePage() returns PHYSICAL pixels, so on a 150%-scaled display the
  // capture comes back 1338px wide instead of 891 and every pixel assertion
  // lands somewhere else. Pinning this makes the capture identical anywhere.
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
}

let answered = false;
const answer = (choice) => {
  if (answered) return;
  answered = true;
  // exit() does not flush stdout when it is an async pipe, which it is on
  // POSIX. Dropping the write costs a real Proceed: the parent parses "" and
  // refuses. Exit only once the bytes are away, with a timer so a callback
  // that never fires cannot hang the window open either.
  let done = false;
  const quit = () => { if (!done) { done = true; app.exit(0); } };
  setTimeout(quit, 1000);
  try {
    process.stdout.write(JSON.stringify({ choice }), quit);
  } catch {
    quit();
  }
};

// Hard failsafe: force-closes and refuses no matter what this process is
// doing, from the very first tick — including while still parsing stdin,
// before any window exists. Never ship a path that can leave this process (or
// a window it opened) stuck on a user's screen. Deliberately NOT unref'd — the
// spec calls this timer "independent", and an unref'd timer is by definition
// allowed not to fire.
// Overridable only so the invariant itself can be tested; nothing in the
// product sets it, and a missing or nonsense value falls back to 120s.
const FAILSAFE_MS = Number(process.env.WEIRD_ROUTE_FAILSAFE_MS) > 0
  ? Number(process.env.WEIRD_ROUTE_FAILSAFE_MS)
  : 120_000;
setTimeout(() => answer("refuse"), FAILSAFE_MS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Electron's main process does not surface piped stdin through Node's stream
// API: for-await/'data'/'readable' all observe an immediate EOF with zero
// bytes even though the OS pipe genuinely holds the parent's write. Verified
// directly — the stream reports 0 bytes while readSync on the same fd returns
// all of it. Reading fd 0 bypasses that broken plumbing.
const readStdin = async () => {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === "EAGAIN") { await sleep(5); continue; }
      throw e;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const job = await readStdin().catch(() => null);
if (!job || typeof job !== "object" || !Array.isArray(job.lines)) {
  process.stdout.write(JSON.stringify({ choice: "refuse" }));
  process.exit(0);
}

const options = Array.isArray(job.options) ? job.options : [];
const chars = totalChars(job.lines);

const state = {
  kind: job.kind === "complete" ? "complete" : "gate",
  beat: 1,
  cursor: Number.isInteger(job.default) ? job.default : 0,
  crawling: !CAPTURE && chars > 0,
  options,
};
let revealed = CAPTURE ? chars : 0;
let crawlTimer = null;

// NEVER `await app.whenReady()` at the top level of an ESM entry point.
// Measured on Electron 43.2.0: the browser process withholds `ready` until the
// entry module has finished evaluating, so a top-level await on it deadlocks —
// evaluation waits for ready, ready waits for evaluation. The process then sits
// forever with no window, no error and no output, which reads exactly like a
// broken install. Self-resolving top-level awaits (readStdin above) are fine;
// only awaiting `ready` deadlocks.
app.whenReady().then(async () => {

// A missing sprite or border must never produce a half-drawn box. Audio is
// deliberately exempt — play() swallows its own failures, because a missing
// sound effect is cosmetic and must not turn into a refusal.
try {
  await access(join(ASSETS, "border.png"));
  if (job.face) await access(join(ASSETS, "noelle", `${job.face}.png`));
} catch {
  return answer("refuse");
}

// Claude Code can gate two tool calls from one assistant block, producing two
// boxes at once. Centred identically they stack exactly, and only the focused
// one receives before-input-event — the other cannot be answered, moved, or
// alt-tabbed to (frameless, skipTaskbar) and just covers the screen until its
// failsafe. A deterministic cascade keeps every window reachable. The box is
// also draggable, so one can always be pulled aside.
const W = BOX.width * SCALE;
const H = BOX.height * SCALE;
const area = screen.getPrimaryDisplay().workAreaSize;
const step = (process.pid % 6) * 28;

// Dead centre is the game-accurate placement, but it lands on top of whatever
// you are working on. WEIRD_ROUTE_POS moves it out of the way.
const MARGIN = 24;
const PLACES = {
  center: [Math.round((area.width - W) / 2), Math.round((area.height - H) / 2)],
  "top-left": [MARGIN, MARGIN],
  "top-right": [area.width - W - MARGIN, MARGIN],
  "bottom-left": [MARGIN, area.height - H - MARGIN],
  "bottom-right": [area.width - W - MARGIN, area.height - H - MARGIN],
};
const [baseX, baseY] = PLACES[process.env.WEIRD_ROUTE_POS] ?? PLACES.center;

const win = new BrowserWindow({
  width: W,
  height: H,
  x: Math.max(0, baseX + step),
  y: Math.max(0, baseY + step),
  frame: false,
  transparent: true,
  backgroundColor: "#00000000",   // Windows needs this explicitly with transparent
  alwaysOnTop: true,
  resizable: false,
  skipTaskbar: true,
  show: false,                    // reveal only once painted, so no white flash
  webPreferences: { preload: join(HERE, "preload.cjs"), contextIsolation: true },
});

win.setAlwaysOnTop(true, "screen-saver");

const send = (channel, payload) => {
  if (!win.isDestroyed()) win.webContents.send(channel, payload);
};
const play = (file) => send("sfx", file);
const paint = () => send("render", { revealed, beat: state.beat, cursor: state.cursor });

const stopCrawl = () => {
  if (crawlTimer) clearInterval(crawlTimer);
  crawlTimer = null;
  state.crawling = false;
  revealed = chars;
  paint();
};

const startCrawl = () => {
  if (!state.crawling) return paint();
  const flat = job.lines.join("");
  crawlTimer = setInterval(() => {
    revealed += 1;
    const ch = flat[revealed - 1];
    if (ch && ch !== " ") play("voice_noelle.wav");
    paint();
    if (revealed >= chars) stopCrawl();
  }, CRAWL_MS);
};

// Keys are read in main so the rules stay in a unit-tested pure function.
// before-input-event sees every key the window receives, including Escape,
// without the page needing a listener of its own.
win.webContents.on("before-input-event", (_event, input) => {
  if (input.type !== "keyDown") return;
  const action = keyAction(state, input.key);
  switch (action.type) {
    case "answer":
      play(action.choice === "refuse" ? "ominous_cancel.wav" : "ui_select.wav");
      // Let the sound start before the window vanishes.
      setTimeout(() => answer(action.choice), 120);
      return;
    case "skip":
      stopCrawl();
      return;
    case "choice":
      state.beat = 2;
      paint();
      return;
    case "move":
      state.cursor = action.to;
      play("ui_move.wav");
      paint();
      return;
    case "back":
      state.beat = 1;
      paint();
      return;
    default:
      return;
  }
});

ipcMain.on("job:request", (e) =>
  e.reply("job", {
    job: { ...job, options },
    scale: SCALE,
    assets: ASSETS,
    box: BOX,
    rows: [rowY(0), rowY(1), rowY(2)],
    optionX: OPTION_X,
    faceOffset,
    state: { revealed, beat: state.beat, cursor: state.cursor },
  }));

// Anything that throws in here must still resolve the process. An earlier
// version left this async handler uncaught: capturePage rejected with
// UnknownVizError and the process sat for the full failsafe with nothing but
// an UnhandledPromiseRejectionWarning on stderr.
ipcMain.on("ready", async () => {
  // Automated runs keep the window hidden. It still renders, still receives
  // input events, still captures — it just does not flash over whatever the
  // user is doing every time the suite runs.
  if (!process.env.WEIRD_ROUTE_KEYS && !CAPTURE) win.show();
  if (job.sfx === "start") play("ui_spooky_action.wav");
  startCrawl();

  // Test-only: replay a key sequence through the real input path. These go in
  // as genuine input events, so they travel before-input-event -> keyAction ->
  // answer exactly as a keypress does. Without this the interaction is only
  // ever verified by hand, and "the reducer is correct" is not the same claim
  // as "the app responds to the keyboard".
  // Gated behind an explicit dev flag: the default cursor is Proceed, so
  // WEIRD_ROUTE_KEYS=Z,Z,Z makes every box self-confirm 240 ms after opening.
  // That is a working gate bypass if it can be set from the environment alone.
  if (process.env.WEIRD_ROUTE_KEYS && process.env.WEIRD_ROUTE_DEV === "1") {
    process.stderr.write("weird-route: DEV key replay active\n");
    for (const code of process.env.WEIRD_ROUTE_KEYS.split(",")) {
      await sleep(80);
      if (answered || win.isDestroyed()) return;
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: code });
    }
  }

  if (!CAPTURE) return;
  try {
    // The compositor needs a presented frame before it can hand one back;
    // capturing the instant after show() rejects with UnknownVizError.
    await sleep(250);
    const image = await win.webContents.capturePage();
    await writeFile(CAPTURE, image.toPNG());
  } catch (e) {
    process.stderr.write(`capture failed: ${e?.stack ?? e}\n`);
  }
  answer("refuse");
});

// A page that fails to load can never answer, so it must not wait out the
// failsafe: surface it and refuse now.
win.webContents.on("did-fail-load", (_e, code, desc) => {
  process.stderr.write(`box.html failed to load: ${code} ${desc}\n`);
  answer("refuse");
});
win.webContents.on("preload-error", (_e, path, err) => {
  process.stderr.write(`preload failed: ${path} ${err}\n`);
  answer("refuse");
});
win.on("closed", () => answer("refuse"));

await win.loadFile(join(HERE, "box.html"));

}).catch((e) => {
  process.stderr.write(`renderer startup failed: ${e?.stack ?? e}\n`);
  answer("refuse");
});
