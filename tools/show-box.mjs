// tools/show-box.mjs — shows the box once, with no gate and no Claude Code.
//
// Feeds the job over stdin from Node rather than a shell: `echo '...' |` does
// not work here, because PowerShell's echo appends CRLF and may emit a BOM,
// and the project path contains spaces.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Absolute, so this works from any working directory.
const child = spawn(require("electron"), [join(ROOT, "renderer", "popup", "main.mjs")], {
  cwd: ROOT,
  stdio: ["pipe", "inherit", "inherit"],
});

child.on("error", (e) => {
  process.stderr.write(`could not start Electron: ${e.message}\nRun npm install first.\n`);
  process.exit(1);
});

console.error("Z advances, arrows move the soul, Z confirms, X goes back, Esc closes.");

child.stdin.end(JSON.stringify({
  kind: "gate",
  face: "trance",
  lines: ["* Kris... it wants to", "  rewrite 14 files."],
  options: ["Proceed", "Refuse"],
  default: 0,
  sfx: "start",
}));
