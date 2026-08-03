// See the inline box without a gate, and without a terminal takeover.
//
//   node tools/show-inline.mjs                 the choice screen
//   node tools/show-inline.mjs --beat 1        her line
//   node tools/show-inline.mjs --plain         no colour, for reading structure
//   node tools/show-inline.mjs --face scared
//
// Runs from any directory: every path is resolved from this file.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { decodePng } from "../src/png.mjs";
import { halfBlocks, stripAnsi } from "../src/sprite.mjs";
import { layout } from "../src/cells.mjs";
import { buildFrame } from "../src/frame.mjs";
import { buildJob } from "../src/job.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "assets");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);

const job = buildJob(
  { hook_event_name: "PreToolUse", tool_name: "Bash",
    tool_input: { command: arg("command", "npm test && git push origin main") } },
  { routeActive: true, autoContinues: 0 });

if (arg("face", null)) job.face = arg("face", null);

const beat = Number(arg("beat", "2")) === 1 ? 1 : 2;
const term = {
  cols: Number(arg("cols", process.stdout.columns || 100)),
  rows: Number(arg("rows", process.stdout.rows || 40)),
};

const box = layout(term, { withFace: !!job.face });

let faceRows = [];
if (box.faceCols > 0) {
  const png = join(ASSETS, "noelle", `${job.face}.png`);
  if (existsSync(png)) {
    faceRows = halfBlocks(decodePng(png), { divisor: box.divisor });
  } else {
    process.stderr.write(`no sprite at ${png} — drawing the box without her\n`);
  }
}

const state = { beat, revealed: Number.MAX_SAFE_INTEGER, cursor: 0 };
const rows = buildFrame(job, state, box, faceRows);

process.stderr.write(
  `terminal ${term.cols}x${term.rows}  box ${box.width}x${box.height}  ` +
  `divisor ${box.divisor}  face ${box.faceCols}x${box.faceRows} cells\n`);

for (const row of rows) process.stdout.write((flag("plain") ? stripAnsi(row) : row) + "\n");
