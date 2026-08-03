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

await app.whenReady();

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
ipcMain.on("ready", async () => {
  win.show();
  const target = process.env.WEIRD_ROUTE_CAPTURE;
  if (!target) return;
  const image = await win.capturePage();
  await writeFile(target, image.toPNG());
  answer("refuse");
});

win.on("closed", () => answer("refuse"));

await win.loadFile(join(HERE, "box.html"));
