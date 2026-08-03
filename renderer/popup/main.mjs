// Electron main process for the Deltarune gate box. Reads a job on stdin,
// shows the box, and writes a single {"choice":"..."} line to stdout. See
// src/renderer-client.mjs for the contract this process must honour: non-zero
// exit, malformed stdout, or a 120s timeout are all treated as "refuse".
import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { writeFile } from "node:fs/promises";
import { readSync } from "node:fs";
import { BOX, rowY } from "../../src/geometry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCALE = 3;

// Capturing a transparent, always-on-top window through the GPU compositor
// fails with UnknownVizError on Windows. The capture path is test-only, so it
// drops to software compositing rather than changing how the real overlay is
// drawn. Must be called before the app is ready.
if (process.env.WEIRD_ROUTE_CAPTURE) {
  app.disableHardwareAcceleration();
  // capturePage() returns PHYSICAL pixels, so on a 150%-scaled display the
  // capture comes back 1338 px wide instead of 891 and every pixel assertion
  // lands somewhere else. Pinning the scale factor makes the capture identical
  // on any machine; without it this test passes or fails based on the
  // developer's monitor settings.
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
}

let answered = false;
const answer = (choice) => {
  if (answered) return;
  answered = true;
  process.stdout.write(JSON.stringify({ choice }));
  app.exit(0);
};

// Hard failsafe: force-closes and refuses no matter what this process is
// doing, from the very first tick — including while still parsing stdin,
// before any window exists. Never ship a path that can leave this process
// (or a window it opened) stuck on a user's screen. Deliberately NOT
// unref'd — the spec calls this timer "independent", and an unref'd timer
// is by definition allowed not to fire.
setTimeout(() => answer("refuse"), 120_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Electron's main process does not reliably surface piped stdin through
// Node's stream API here: for-await/'data'/'readable' all observe an
// immediate EOF with zero bytes even though the OS pipe genuinely holds the
// parent's write (verified with fs.readSync against the same fd, which reads
// it correctly). Reading fd 0 directly bypasses that broken plumbing. EAGAIN
// is handled defensively with a real (await-ing) yield rather than a busy
// spin, so the failsafe timer above can still preempt a pathological stall.
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
if (!job) { process.stdout.write(JSON.stringify({ choice: "refuse" })); process.exit(0); }

// NEVER `await app.whenReady()` at the top level of an ESM entry point.
// Measured on Electron 43.2.0: the browser process withholds `ready` until the
// entry module has finished evaluating, so a top-level await on it deadlocks —
// evaluation waits for ready, ready waits for evaluation. The process then sits
// forever with no window, no error and no output, which reads exactly like a
// broken install. Reproduced with a four-line script, and confirmed the same
// script works both as CJS and as ESM using `.then()`. Self-resolving top-level
// awaits (readStdin above) are harmless; only awaiting `ready` deadlocks.
app.whenReady().then(async () => {

const win = new BrowserWindow({
  width: BOX.width * SCALE,
  height: BOX.height * SCALE,
  frame: false,
  transparent: true,
  backgroundColor: "#00000000",   // Windows needs this explicitly with transparent
  alwaysOnTop: true,
  resizable: false,
  skipTaskbar: true,
  center: true,
  show: false,                    // reveal only once painted, so no white flash
  webPreferences: { preload: join(HERE, "preload.cjs"), contextIsolation: true },
});

win.setAlwaysOnTop(true, "screen-saver");
ipcMain.on("choice", (_e, choice) => answer(choice));

// Geometry travels over IPC rather than being imported by the page. Chromium
// blocks ES-module imports over file://, so `import ... from "src/geometry.mjs"`
// inside box.html fails with an opaque CORS error. Main already holds the
// constants, so it forwards them — geometry.mjs stays the single source of truth.
ipcMain.on("job:request", (e) =>
  e.reply("job", {
    job,
    scale: SCALE,
    assets: join(HERE, "..", "..", "assets"),
    box: BOX,
    rows: [rowY(0), rowY(1), rowY(2)],
  }));

// Test-only: capture the painted window and exit. This is the only way to
// assert the geometry landed where geometry.mjs says it should.
//
// Anything that throws in here must still resolve the process. An earlier
// version left this async handler uncaught: capturePage rejected with
// UnknownVizError and the process sat for the full failsafe with nothing but
// an UnhandledPromiseRejectionWarning on stderr.
ipcMain.on("ready", async () => {
  win.show();
  const target = process.env.WEIRD_ROUTE_CAPTURE;
  if (!target) return;
  try {
    // The compositor needs a presented frame before it can hand one back;
    // capturing the instant after show() rejects with UnknownVizError.
    await new Promise((r) => setTimeout(r, 250));
    const image = await win.webContents.capturePage();
    await writeFile(target, image.toPNG());
  } catch (e) {
    process.stderr.write(`capture failed: ${e?.stack ?? e}\n`);
  }
  answer("refuse");
});

win.on("closed", () => answer("refuse"));

// A page that fails to load can never answer, so it must not wait for the
// failsafe: surface it and refuse now.
win.webContents.on("did-fail-load", (_e, code, desc) => {
  process.stderr.write(`box.html failed to load: ${code} ${desc}\n`);
  answer("refuse");
});
win.webContents.on("preload-error", (_e, path, err) => {
  process.stderr.write(`preload failed: ${path} ${err}\n`);
  answer("refuse");
});

await win.loadFile(join(HERE, "box.html"));

}).catch((e) => {
  process.stderr.write(`renderer startup failed: ${e?.stack ?? e}\n`);
  answer("refuse");
});
