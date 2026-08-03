// tools/show-box.mjs — feeds a job over stdin without shell quoting. `echo |`
// does not work here: PowerShell's echo appends CRLF and may emit a BOM, and
// the project path contains spaces.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const child = spawn(createRequire(import.meta.url)("electron"), ["renderer/popup/main.mjs"], { stdio: ["pipe", "inherit", "inherit"] });
child.stdin.end(JSON.stringify({
  kind: "gate", face: "trance",
  lines: ["* Kris... it wants to", "  rewrite 14 files."],
  options: ["Proceed", "Refuse"], default: 0, sfx: null,
}));
