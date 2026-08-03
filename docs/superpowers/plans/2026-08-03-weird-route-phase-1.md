# Deltarune Weird Route — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that gates Claude's autonomy behind a pixel-faithful Deltarune Weird Route dialogue box, rendered in a frameless always-on-top Electron window.

**Architecture:** Three Claude Code hooks (`PreToolUse`, `Stop`, `Notification`) all enter one dispatcher, `hooks/gate.mjs`. The dispatcher decides whether a box is warranted, builds a job, and hands it to a renderer over stdin/stdout. The renderer is a separate process behind a JSON contract, so Phase 2's terminal renderer is a drop-in replacement. All box geometry lives in exactly one module.

**Tech Stack:** Node 24 (ESM, `node:test` built in — no test framework dependency), Electron for the window, no other runtime dependencies.

## Global Constraints

- Node 24 / npm 11. **No Rust on this box** — Tauri and any Rust-based toolkit are out.
- Test runner is `node:test` + `node:assert/strict`. Do not add Jest, Vitest, or Mocha.
- All source is ESM (`.mjs`, or `"type": "module"`). No CommonJS.
- **Box geometry is declared once**, in `src/geometry.mjs`. No other file restates a pixel value.
- **Fail closed.** Every renderer failure path resolves to `refuse`. A gate that fails open hands Claude unrestricted tool access.
- **Refuse always ends the route.** It is never "reject this step and try another."
- Auto-continue ceiling is **25** consecutive silent continues.
- `assets/` is copyrighted material and must be in `.gitignore` before the first commit.
- **No extra model calls.** The `NEXT:` marker is harvested by string parsing. Never add a sub-agent, a second model, or any automated model loop to this plugin — `.claude/CLAUDE.md` records a prior cost incident of exactly that shape.
- Character advance is **8 px**; **27 chars/line** with a portrait, **34** without.

## Reference

Design spec: `docs/superpowers/specs/2026-08-03-deltarune-weird-route-design.md`

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | ESM, scripts, Electron devDependency |
| `.gitignore` | `assets/`, `node_modules/`, `.superpowers/`, `state/` |
| `src/geometry.mjs` | Every pixel constant, `rowY()`, `wrapLines()`, `assertFits()` |
| `src/transcript.mjs` | Read session transcript, extract the `NEXT:` marker |
| `src/state.mjs` | Per-session counter and route flag; load/save/reset |
| `src/job.mjs` | Hook payload → renderer job, or `null` for no box |
| `src/renderer-client.mjs` | Spawn renderer, write job, read choice, timeout → refuse |
| `hooks/gate.mjs` | Hook entry; dispatch by event; map choice → hook decision |
| `renderer/popup/main.mjs` | Electron main: frameless, transparent, always-on-top |
| `renderer/popup/box.html` | Box markup + styles |
| `renderer/popup/box.mjs` | Typewriter, soul navigation, keys, SFX, teardown timer |
| `tests/*.test.mjs` | One test file per `src/` module |

---

### Task 1: Scaffold and geometry

Geometry is the foundation every other task imports. It ships first, with the wrapping bug that broke the first render already covered by a test.

**Files:**
- Create: `package.json`, `.gitignore`, `src/geometry.mjs`
- Test: `tests/geometry.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `BOX` — frozen object of pixel constants
  - `rowY(n: number): number`
  - `MAX_CHARS: { withPortrait: 27, noPortrait: 34 }`
  - `wrapLines(text: string, opts?: { withPortrait?: boolean }): string[]`
  - `assertFits(x: number, text: string, label: string): number` — returns `x`, throws on overflow

- [ ] **Step 1: Write the failing test**

```javascript
// tests/geometry.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { BOX, rowY, MAX_CHARS, wrapLines, assertFits } from "../src/geometry.mjs";

test("box constants match the spec", () => {
  assert.equal(BOX.width, 297);
  assert.equal(BOX.height, 84);
  assert.equal(BOX.border, 7);
  assert.equal(BOX.advance, 8);
  assert.deepEqual(BOX.slot, { x: 7, y: 7, w: 67, h: 70 });
  assert.equal(BOX.textX.withPortrait, 69);
  assert.equal(BOX.textX.noPortrait, 11);
});

test("rows sit at 7, 25, 43", () => {
  assert.deepEqual([0, 1, 2].map(rowY), [7, 25, 43]);
});

test("line budgets are derived, not hardcoded guesses", () => {
  assert.equal(MAX_CHARS.withPortrait, 27);
  assert.equal(MAX_CHARS.noPortrait, 34);
});

test("wrapLines never exceeds the budget", () => {
  const rows = wrapLines("* Kris... it wants to rewrite 14 files.");
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.ok(r.length <= 27, `"${r}" is ${r.length} chars`);
});

test("wrapLines indents continuation rows by two", () => {
  const rows = wrapLines("* Kris... it wants to rewrite 14 files.");
  assert.equal(rows[0].startsWith("*"), true);
  for (const r of rows.slice(1)) assert.equal(r.startsWith("  "), true);
});

test("assertFits rejects a run past the inner right edge", () => {
  assert.throws(() => assertFits(196, "ThisIsFarTooLongToFit", "Refuse"), /inner right edge/);
  assert.equal(assertFits(196, "Refuse", "Refuse"), 196);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/geometry.test.mjs`
Expected: FAIL — `Cannot find module '../src/geometry.mjs'`

- [ ] **Step 3: Create `package.json` and `.gitignore`**

```json
{
  "name": "deltarune-weird-route",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "box": "electron renderer/popup/main.mjs"
  },
  "devDependencies": {
    "electron": "^32.0.0"
  }
}
```

```gitignore
# Copyrighted Toby Fox material — sprites, font, SFX. Never commit.
assets/

node_modules/
state/
.superpowers/
.playwright-mcp/
*.png
```

- [ ] **Step 4: Write the implementation**

```javascript
// src/geometry.mjs
// Deltarune text box geometry. Single source of truth — no other file may
// restate a pixel value. Numbers verified against the Deltarune border profile
// in xMirkix/yet-another-textbox-generator and by decoding the border asset.

export const BOX = Object.freeze({
  width: 297,
  height: 84,
  border: 7,
  slot: Object.freeze({ x: 7, y: 7, w: 67, h: 70 }),
  slotRight: Object.freeze({ x: 223, y: 7 }),
  fontSize: 16,
  lineHeight: 18,
  textY: 7,
  textX: Object.freeze({ withPortrait: 69, noPortrait: 11 }),
  asteriskOffset: -1,
  advance: 8,          // measured: Determination Mono Web is true monospace
  soul: 16,
  cornerColor: "rgb(170,255,230)",
  corners: Object.freeze([[6, 6], [290, 6], [6, 77], [290, 77]]),
});

export const innerRight = BOX.width - BOX.border;   // 290

export const rowY = (n) => BOX.textY + n * BOX.lineHeight;

export const MAX_CHARS = Object.freeze({
  withPortrait: Math.floor((innerRight - BOX.textX.withPortrait) / BOX.advance),
  noPortrait: Math.floor((innerRight - BOX.textX.noPortrait) / BOX.advance),
});

export const MAX_ROWS = 3;

export function wrapLines(text, { withPortrait = true } = {}) {
  const max = withPortrait ? MAX_CHARS.withPortrait : MAX_CHARS.noPortrait;
  const out = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur === "" ? word : `${cur} ${word}`;
    if (next.length > max) {
      out.push(cur);
      cur = `  ${word}`;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function assertFits(x, text, label) {
  const end = x + text.length * BOX.advance;
  if (end > innerRight) {
    throw new Error(`${label} ends at ${end}, inner right edge is ${innerRight}`);
  }
  return x;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `node --test tests/geometry.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore src/geometry.mjs tests/geometry.test.mjs
git commit -m "feat: box geometry as single source of truth"
```

---

### Task 2: Transcript reader

Extracts the `NEXT:` marker. A turn with a marker auto-continues silently; a turn without one is route-complete.

**Files:**
- Create: `src/transcript.mjs`
- Test: `tests/transcript.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `extractNext(text: string): string | null`
  - `readLastAssistantText(transcriptPath: string): Promise<string>` — returns `""` if unreadable

- [ ] **Step 1: Write the failing test**

```javascript
// tests/transcript.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractNext, readLastAssistantText } from "../src/transcript.mjs";

test("extracts a NEXT marker", () => {
  assert.equal(extractNext("Done.\nNEXT: rewrite the auth module"), "rewrite the auth module");
});

test("uses the last marker when several appear", () => {
  assert.equal(extractNext("NEXT: first\nmore text\nNEXT: second"), "second");
});

test("returns null when there is no marker", () => {
  assert.equal(extractNext("All finished, nothing left to do."), null);
});

test("ignores an empty marker", () => {
  assert.equal(extractNext("NEXT:   "), null);
});

test("reads the last assistant message from a JSONL transcript", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  const path = join(dir, "t.jsonl");
  await writeFile(path, [
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "first" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "NEXT: go" }] } }),
  ].join("\n"));
  assert.equal(await readLastAssistantText(path), "NEXT: go");
});

test("returns empty string when the transcript is unreadable", async () => {
  assert.equal(await readLastAssistantText("/nope/missing.jsonl"), "");
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/transcript.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// src/transcript.mjs
import { readFile } from "node:fs/promises";

const MARKER = /^NEXT:\s*(.+?)\s*$/gm;

export function extractNext(text) {
  if (!text) return null;
  let last = null;
  for (const m of text.matchAll(MARKER)) {
    const value = m[1].trim();
    if (value) last = value;
  }
  return last;
}

// Claude Code writes the session transcript as JSON Lines. Unreadable or
// malformed transcripts are not an error: they mean "no marker", which the
// dispatcher treats as route-complete.
export async function readLastAssistantText(transcriptPath) {
  let raw;
  try {
    raw = await readFile(transcriptPath, "utf8");
  } catch {
    return "";
  }
  let latest = "";
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (typeof content === "string") latest = content;
    else if (Array.isArray(content)) {
      latest = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    }
  }
  return latest;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/transcript.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/transcript.mjs tests/transcript.test.mjs
git commit -m "feat: harvest NEXT marker from session transcript"
```

---

### Task 3: Session state

Tracks whether the route is running and how many silent auto-continues have elapsed.

**Files:**
- Create: `src/state.mjs`
- Test: `tests/state.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `AUTO_CONTINUE_LIMIT = 25`
  - `loadState(sessionId: string, dir?: string): Promise<State>` where `State = { routeActive: boolean, autoContinues: number }`
  - `saveState(sessionId: string, state: State, dir?: string): Promise<void>`
  - `bump(state: State): State` — returns a new state with `autoContinues + 1`
  - `atLimit(state: State): boolean`
  - `reset(state: State): State` — `autoContinues` back to 0

- [ ] **Step 1: Write the failing test**

```javascript
// tests/state.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTO_CONTINUE_LIMIT, loadState, saveState, bump, atLimit, reset } from "../src/state.mjs";

test("the ceiling is 25", () => {
  assert.equal(AUTO_CONTINUE_LIMIT, 25);
});

test("an unknown session starts inactive at zero", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  assert.deepEqual(await loadState("nope", dir), { routeActive: false, autoContinues: 0 });
});

test("state round-trips through disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  await saveState("s1", { routeActive: true, autoContinues: 3 }, dir);
  assert.deepEqual(await loadState("s1", dir), { routeActive: true, autoContinues: 3 });
});

test("bump does not mutate its input", () => {
  const before = { routeActive: true, autoContinues: 1 };
  const after = bump(before);
  assert.equal(before.autoContinues, 1);
  assert.equal(after.autoContinues, 2);
});

test("atLimit trips at exactly 25, not before", () => {
  assert.equal(atLimit({ routeActive: true, autoContinues: 24 }), false);
  assert.equal(atLimit({ routeActive: true, autoContinues: 25 }), true);
  assert.equal(atLimit({ routeActive: true, autoContinues: 26 }), true);
});

test("reset clears the counter but leaves the route running", () => {
  assert.deepEqual(reset({ routeActive: true, autoContinues: 25 }),
                   { routeActive: true, autoContinues: 0 });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/state.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// src/state.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const AUTO_CONTINUE_LIMIT = 25;

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "state");
const fresh = () => ({ routeActive: false, autoContinues: 0 });
const pathFor = (sessionId, dir) => join(dir, `${sessionId}.json`);

export async function loadState(sessionId, dir = DEFAULT_DIR) {
  try {
    const parsed = JSON.parse(await readFile(pathFor(sessionId, dir), "utf8"));
    return { routeActive: !!parsed.routeActive, autoContinues: parsed.autoContinues ?? 0 };
  } catch {
    return fresh();
  }
}

export async function saveState(sessionId, state, dir = DEFAULT_DIR) {
  await mkdir(dir, { recursive: true });
  await writeFile(pathFor(sessionId, dir), JSON.stringify(state), "utf8");
}

export const bump = (state) => ({ ...state, autoContinues: state.autoContinues + 1 });
export const reset = (state) => ({ ...state, autoContinues: 0 });
export const atLimit = (state) => state.autoContinues >= AUTO_CONTINUE_LIMIT;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/state.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/state.mjs tests/state.test.mjs
git commit -m "feat: per-session route state and auto-continue counter"
```

---

### Task 4: Job builder

Turns a hook payload into a renderer job, or `null` when no box is warranted. This is where the read-only tool filter lives.

**Files:**
- Create: `src/job.mjs`
- Test: `tests/job.test.mjs`

**Interfaces:**
- Consumes: `wrapLines` from `src/geometry.mjs`
- Produces:
  - `CONSEQUENTIAL_TOOLS: string[]`
  - `describeTool(toolName: string, toolInput: object): string` — Noelle's line
  - `buildJob(payload: object, state: State): Job | null` where
    `Job = { face: string, lines: string[], options: string[], default: number, sfx: string | null, kind: "gate" | "complete" }`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/job.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildJob, describeTool, CONSEQUENTIAL_TOOLS } from "../src/job.mjs";
import { MAX_CHARS } from "../src/geometry.mjs";

const active = { routeActive: true, autoContinues: 0 };

test("read-only tools never raise a box", () => {
  for (const tool of ["Read", "Grep", "Glob"]) {
    const job = buildJob({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: {} }, active);
    assert.equal(job, null, `${tool} should not gate`);
  }
});

test("consequential tools always raise a box", () => {
  for (const tool of CONSEQUENTIAL_TOOLS) {
    const job = buildJob({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: {} }, active);
    assert.ok(job, `${tool} should gate`);
    assert.deepEqual(job.options, ["Proceed", "Refuse"]);
    assert.equal(job.kind, "gate");
  }
});

test("every generated line fits the box", () => {
  const job = buildJob(
    { hook_event_name: "PreToolUse", tool_name: "Bash",
      tool_input: { command: "rm -rf ./build && npm run build && npm publish --access public" } },
    active);
  for (const line of job.lines) {
    assert.ok(line.length <= MAX_CHARS.withPortrait, `"${line}" is ${line.length} chars`);
  }
  assert.ok(job.lines.length <= 3);
});

test("describeTool names the file for an edit", () => {
  const line = describeTool("Edit", { file_path: "C:\\\\proj\\\\src\\\\auth.ts" });
  assert.match(line, /auth\.ts/);
});

test("a Stop with the counter at the limit raises a gate box", () => {
  const job = buildJob({ hook_event_name: "Stop", next: "keep refactoring" },
                       { routeActive: true, autoContinues: 25 });
  assert.ok(job);
  assert.equal(job.kind, "gate");
});

test("a Stop below the limit with a NEXT marker raises no box", () => {
  const job = buildJob({ hook_event_name: "Stop", next: "keep refactoring" },
                       { routeActive: true, autoContinues: 3 });
  assert.equal(job, null);
});

test("a Stop with no NEXT marker raises a choiceless completion box", () => {
  const job = buildJob({ hook_event_name: "Stop", next: null }, active);
  assert.ok(job);
  assert.equal(job.kind, "complete");
  assert.deepEqual(job.options, []);
  assert.equal(job.sfx, null);
});

test("nothing gates when the route is not running", () => {
  const idle = { routeActive: false, autoContinues: 0 };
  assert.equal(buildJob({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, idle), null);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/job.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// src/job.mjs
import { wrapLines, MAX_ROWS } from "./geometry.mjs";
import { atLimit } from "./state.mjs";

export const CONSEQUENTIAL_TOOLS = ["Write", "Edit", "Bash", "WebFetch", "Task"];

const basename = (p = "") => String(p).split(/[\\/]/).pop() || String(p);

export function describeTool(toolName, toolInput = {}) {
  switch (toolName) {
    case "Write":  return `* it wants to write ${basename(toolInput.file_path)}.`;
    case "Edit":   return `* it wants to change ${basename(toolInput.file_path)}.`;
    case "Bash":   return `* it wants to run a command.`;
    case "WebFetch": return `* it wants to reach the outside.`;
    case "Task":   return `* it wants to send someone else.`;
    default:       return `* it wants to use ${toolName}.`;
  }
}

// Noelle's lines are wrapped and then hard-truncated to the three rows the box
// holds. Truncation is deliberate: an overlong tool description must never push
// the choice row out of the box.
const speak = (...paragraphs) =>
  paragraphs.flatMap((p) => wrapLines(p)).slice(0, MAX_ROWS);

export function buildJob(payload, state) {
  if (!state.routeActive) return null;

  if (payload.hook_event_name === "PreToolUse") {
    if (!CONSEQUENTIAL_TOOLS.includes(payload.tool_name)) return null;
    return {
      kind: "gate",
      face: "trance",
      lines: speak("* Kris...", describeTool(payload.tool_name, payload.tool_input)),
      options: ["Proceed", "Refuse"],
      default: 0,
      sfx: null,
    };
  }

  if (payload.hook_event_name === "Notification") {
    return {
      kind: "gate",
      face: "mortified",
      lines: speak("* Kris... it's waiting for you."),
      options: ["Proceed", "Refuse"],
      default: 0,
      sfx: null,
    };
  }

  if (payload.hook_event_name === "Stop") {
    if (!payload.next) {
      return {
        kind: "complete",
        face: "speechless",
        lines: speak("* ...it's done, Kris."),
        options: [],
        default: 0,
        sfx: null,
      };
    }
    if (atLimit(state)) {
      return {
        kind: "gate",
        face: "mortified_stare",
        lines: speak("* Kris... how long has it been?"),
        options: ["Proceed", "Refuse"],
        default: 0,
        sfx: null,
      };
    }
    return null;
  }

  return null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/job.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/job.mjs tests/job.test.mjs
git commit -m "feat: build renderer jobs and filter read-only tools"
```

---

### Task 5: Renderer client

Spawns the renderer and reads the answer. Every failure mode resolves to `refuse` — this is the safety-critical module.

**Files:**
- Create: `src/renderer-client.mjs`
- Test: `tests/renderer-client.test.mjs`, `tests/fixtures/fake-renderer.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `RENDER_TIMEOUT_MS = 120_000`
  - `askUser(job: Job, opts?: { command?: string, args?: string[], timeoutMs?: number }): Promise<"proceed" | "refuse">`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/renderer-client.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { askUser, RENDER_TIMEOUT_MS } from "../src/renderer-client.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-renderer.mjs", import.meta.url));
const job = { kind: "gate", face: "trance", lines: ["* hi"], options: ["Proceed", "Refuse"], default: 0, sfx: null };
const run = (mode, timeoutMs) =>
  askUser(job, { command: process.execPath, args: [FAKE, mode], timeoutMs });

test("the timeout default is 120 seconds", () => {
  assert.equal(RENDER_TIMEOUT_MS, 120_000);
});

test("a proceed answer comes back as proceed", async () => {
  assert.equal(await run("proceed"), "proceed");
});

test("a refuse answer comes back as refuse", async () => {
  assert.equal(await run("refuse"), "refuse");
});

test("a crashed renderer fails closed", async () => {
  assert.equal(await run("crash"), "refuse");
});

test("garbage on stdout fails closed", async () => {
  assert.equal(await run("garbage"), "refuse");
});

test("an unknown choice value fails closed", async () => {
  assert.equal(await run("bogus-choice"), "refuse");
});

test("a missing renderer binary fails closed", async () => {
  assert.equal(await askUser(job, { command: "definitely-not-a-real-binary-xyz", args: [] }), "refuse");
});

test("a hung renderer is killed and fails closed", async () => {
  assert.equal(await run("hang", 300), "refuse");
});
```

- [ ] **Step 2: Write the fake renderer fixture**

```javascript
// tests/fixtures/fake-renderer.mjs
const mode = process.argv[2];
if (mode === "crash") process.exit(3);
if (mode === "garbage") { process.stdout.write("not json at all"); process.exit(0); }
if (mode === "bogus-choice") { process.stdout.write(JSON.stringify({ choice: "maybe" })); process.exit(0); }
if (mode === "hang") { setTimeout(() => {}, 60_000); }
else { process.stdout.write(JSON.stringify({ choice: mode })); process.exit(0); }
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `node --test tests/renderer-client.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 4: Write the implementation**

```javascript
// src/renderer-client.mjs
import { spawn } from "node:child_process";

export const RENDER_TIMEOUT_MS = 120_000;

// Every failure path returns "refuse". A gate that fails open silently hands
// Claude unrestricted tool access, which is worse than the plugin not working.
export function askUser(job, { command, args = [], timeoutMs = RENDER_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      resolve(choice === "proceed" ? "proceed" : "refuse");
    };

    let child;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return resolve("refuse");
    }

    const timer = setTimeout(() => finish("refuse"), timeoutMs);

    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", () => finish("refuse"));
    child.on("close", (code) => {
      if (code !== 0) return finish("refuse");
      try {
        finish(JSON.parse(out).choice);
      } catch {
        finish("refuse");
      }
    });

    try {
      child.stdin.end(JSON.stringify(job));
    } catch {
      finish("refuse");
    }
  });
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `node --test tests/renderer-client.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 6: Commit**

```bash
git add src/renderer-client.mjs tests/renderer-client.test.mjs tests/fixtures/fake-renderer.mjs
git commit -m "feat: renderer client that fails closed on every error path"
```

---

### Task 6: The gate dispatcher

Maps a choice onto the hook decision each event expects.

**Files:**
- Create: `hooks/gate.mjs`, `src/decide.mjs`
- Test: `tests/decide.test.mjs`

**Interfaces:**
- Consumes: `buildJob`, `askUser`, state helpers
- Produces:
  - `decide(payload, state, ask): Promise<{ output: object, nextState: State }>` where `ask(job) => Promise<"proceed"|"refuse">` is injected so tests never spawn a process

- [ ] **Step 1: Confirm the hook output schema before writing to it**

Run: `claude --help` and check the hooks documentation for `PreToolUse` and `Stop` output shapes.
Expected: `PreToolUse` accepts `hookSpecificOutput.permissionDecision` of `allow` / `deny` / `ask`; `Stop` accepts `{ "decision": "block", "reason": "..." }` to continue.
If the installed version differs, adjust the shapes in Step 3 and the test in Step 2 together.

- [ ] **Step 2: Write the failing test**

```javascript
// tests/decide.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/decide.mjs";

const active = { routeActive: true, autoContinues: 0 };
const proceed = async () => "proceed";
const refuse = async () => "refuse";

test("proceed allows a gated tool call", async () => {
  const { output } = await decide(
    { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, active, proceed);
  assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
});

test("refuse denies the tool call", async () => {
  const { output } = await decide(
    { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, active, refuse);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
});

test("refuse ends the route", async () => {
  const { nextState } = await decide(
    { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, active, refuse);
  assert.equal(nextState.routeActive, false);
});

test("a silent auto-continue blocks the stop and increments the counter", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Stop", next: "keep going" },
    { routeActive: true, autoContinues: 4 }, proceed);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /keep going/);
  assert.equal(nextState.autoContinues, 5);
});

test("proceeding at the limit resets the counter", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Stop", next: "keep going" },
    { routeActive: true, autoContinues: 25 }, proceed);
  assert.equal(output.decision, "block");
  assert.equal(nextState.autoContinues, 0);
});

test("the completion box ends the route and does not block", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Stop", next: null }, active, proceed);
  assert.equal(output.decision, undefined);
  assert.equal(nextState.routeActive, false);
});

test("an ungated tool passes through untouched", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }, active, refuse);
  assert.deepEqual(output, {});
  assert.deepEqual(nextState, active);
});
```

- [ ] **Step 3: Write the implementation**

```javascript
// src/decide.mjs
import { buildJob } from "./job.mjs";
import { bump, reset } from "./state.mjs";

const allow = () => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow",
                        permissionDecisionReason: "Proceed." },
});
const deny = () => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
                        permissionDecisionReason: "Refused. The route ends here." },
});

export async function decide(payload, state, ask) {
  const job = buildJob(payload, state);

  // Silent auto-continue: a Stop that carries a NEXT marker and is under the
  // ceiling never shows a box.
  if (!job) {
    if (payload.hook_event_name === "Stop" && payload.next && state.routeActive) {
      return {
        output: { decision: "block", reason: payload.next },
        nextState: bump(state),
      };
    }
    return { output: {}, nextState: state };
  }

  if (job.kind === "complete") {
    await ask(job);                                   // dismissal only
    return { output: {}, nextState: { ...state, routeActive: false } };
  }

  const choice = await ask(job);

  if (choice === "refuse") {
    const ended = { ...state, routeActive: false };
    if (payload.hook_event_name === "PreToolUse") return { output: deny(), nextState: ended };
    return { output: {}, nextState: ended };
  }

  if (payload.hook_event_name === "PreToolUse") {
    return { output: allow(), nextState: reset(state) };
  }

  if (payload.hook_event_name === "Stop" && payload.next) {
    return { output: { decision: "block", reason: payload.next }, nextState: reset(state) };
  }

  return { output: {}, nextState: reset(state) };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/decide.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Write the hook entry point**

```javascript
// hooks/gate.mjs
import { readLastAssistantText, extractNext } from "../src/transcript.mjs";
import { loadState, saveState } from "../src/state.mjs";
import { askUser } from "../src/renderer-client.mjs";
import { decide } from "../src/decide.mjs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, "..", "renderer", "popup", "main.mjs");

const readStdin = async () => {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
};

const payload = await readStdin();
if (!payload) process.exit(0);              // unparseable payload: do nothing

if (payload.hook_event_name === "Stop") {
  payload.next = extractNext(await readLastAssistantText(payload.transcript_path));
}

const sessionId = payload.session_id ?? "default";
const state = await loadState(sessionId);

const ask = (job) => askUser(job, { command: "npx", args: ["electron", RENDERER] });
const { output, nextState } = await decide(payload, state, ask);

await saveState(sessionId, nextState);
if (Object.keys(output).length) process.stdout.write(JSON.stringify(output));
process.exit(0);
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, all files

- [ ] **Step 7: Commit**

```bash
git add hooks/gate.mjs src/decide.mjs tests/decide.test.mjs
git commit -m "feat: gate dispatcher mapping choices to hook decisions"
```

---

### Task 7: Electron window and static box

Renders the box correctly and exits. No interaction yet — this task exists so the geometry can be verified visually before behaviour is layered on.

**Files:**
- Create: `renderer/popup/main.mjs`, `renderer/popup/box.html`, `renderer/popup/preload.cjs`

**Interfaces:**
- Consumes: `BOX`, `rowY` from `src/geometry.mjs`
- Produces: a process that reads a job on stdin, shows the box, writes `{"choice":"..."}` on stdout

- [ ] **Step 1: Install Electron**

Run: `npm install`
Expected: `electron` present in `node_modules`

- [ ] **Step 2: Write the Electron main process**

```javascript
// renderer/popup/main.mjs
import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { BOX } from "../../src/geometry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCALE = 3;

let answered = false;
const answer = (choice) => {
  if (answered) return;
  answered = true;
  process.stdout.write(JSON.stringify({ choice }));
  app.exit(0);
};

const readStdin = async () => {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw);
};

const job = await readStdin().catch(() => null);
if (!job) { process.stdout.write(JSON.stringify({ choice: "refuse" })); process.exit(0); }

// Hard failsafe: the window force-closes and refuses no matter what the
// renderer is doing. Never ship a path that can leave an un-closable
// always-on-top window on screen.
setTimeout(() => answer("refuse"), 120_000).unref?.();

await app.whenReady();

const win = new BrowserWindow({
  width: BOX.width * SCALE,
  height: BOX.height * SCALE,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  resizable: false,
  skipTaskbar: true,
  center: true,
  webPreferences: { preload: join(HERE, "preload.cjs"), contextIsolation: true },
});

win.setAlwaysOnTop(true, "screen-saver");
ipcMain.on("choice", (_e, choice) => answer(choice));
ipcMain.on("job:request", (e) => e.reply("job", { job, scale: SCALE, assets: join(HERE, "..", "..", "assets") }));
win.on("closed", () => answer("refuse"));

await win.loadFile(join(HERE, "box.html"));
```

```javascript
// renderer/popup/preload.cjs
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("weird", {
  onJob: (fn) => ipcRenderer.on("job", (_e, data) => fn(data)),
  requestJob: () => ipcRenderer.send("job:request"),
  answer: (choice) => ipcRenderer.send("choice", choice),
});
```

- [ ] **Step 3: Write the box markup**

`renderer/popup/box.html` renders the frame using the constants imported from `src/geometry.mjs` via `box.mjs`. Structure, in this exact z-order — border under text is load-bearing, see the spec:

```html
<div id="box">
  <div id="fill"></div>
  <img id="face">
  <img id="border">
  <div id="corners"></div>
  <div id="text"></div>
  <div id="soul"></div>
</div>
```

Styles mirror the verified mockup: `#box` is `BOX.width` × `BOX.height` with `transform: scale(3)`, `transform-origin: top left`; `#fill` is `inset: BOX.border` on `#000`; `#face` and `#border` are `image-rendering: pixelated`; text spans are absolutely positioned at `rowY(n)`.

- [ ] **Step 4: Verify the render visually**

Run: `echo '{"kind":"gate","face":"trance","lines":["* Kris... it wants to","  rewrite 14 files."],"options":["Proceed","Refuse"],"default":0,"sfx":null}' | npx electron renderer/popup/main.mjs`
Expected: the box appears centred, always on top, transparent-backed, text legible and inside the frame, Noelle visible in the left slot. Close it; stdout prints `{"choice":"refuse"}`.

- [ ] **Step 5: Commit**

```bash
git add renderer/popup/
git commit -m "feat: electron window rendering the deltarune box"
```

---

### Task 8: Interaction, audio, teardown

**Files:**
- Create: `renderer/popup/box.mjs`
- Modify: `renderer/popup/box.html` — load `box.mjs`

**Interfaces:**
- Consumes: `window.weird` from the preload bridge; `BOX`, `rowY`, `assertFits` from geometry
- Produces: nothing importable — this is the leaf

- [ ] **Step 1: Write `renderer/popup/box.mjs`**

```javascript
// renderer/popup/box.mjs
import { BOX, rowY, assertFits } from "../../src/geometry.mjs";

export const OPTION_X = { Proceed: 91, Refuse: 196 };
const CRAWL_MS = 35;

// Pure, so navigation is testable without a browser.
export function nextIndex(current, key, count) {
  if (key === "ArrowRight") return Math.min(current + 1, count - 1);
  if (key === "ArrowLeft") return Math.max(current - 1, 0);
  return current;
}

const el = (id) => document.getElementById(id);
let assets = "";
const play = (name) => {
  if (!name) return;
  const a = new Audio(`file://${assets}/sfx/${name}`);
  a.play().catch(() => {});          // a missing sfx must never block the box
};

let job = null, beat = 1, cursor = 0, crawling = false, revealed = 0, timer = null;

function drawText(upTo = Infinity) {
  const host = el("text");
  host.innerHTML = "";
  let budget = upTo;
  job.lines.forEach((line, n) => {
    const shown = line.slice(0, Math.max(0, budget));
    budget -= line.length;
    const span = document.createElement("span");
    span.className = "t";
    span.style.left = `${BOX.textX.withPortrait + (line.startsWith("*") ? BOX.asteriskOffset : 0)}px`;
    span.style.top = `${rowY(n)}px`;
    span.textContent = shown;
    host.appendChild(span);
  });
}

const totalChars = () => job.lines.reduce((n, l) => n + l.length, 0);

function crawl() {
  crawling = true;
  timer = setInterval(() => {
    revealed += 1;
    const ch = job.lines.join("")[revealed - 1];
    if (ch && ch !== " ") play("voice_noelle.wav");
    drawText(revealed);
    if (revealed >= totalChars()) finishCrawl();
  }, CRAWL_MS);
}

function finishCrawl() {
  clearInterval(timer);
  crawling = false;
  revealed = totalChars();
  drawText();
}

function showChoice() {
  beat = 2;
  const host = el("text");
  job.options.forEach((label) => {
    const x = assertFits(OPTION_X[label], label, label);
    const span = document.createElement("span");
    span.className = "t";
    span.style.left = `${x}px`;
    span.style.top = `${rowY(2)}px`;
    span.textContent = label;
    host.appendChild(span);
  });
  el("soul").style.display = "block";
  moveSoul(0);
}

function moveSoul(index) {
  cursor = index;
  const label = job.options[cursor];
  el("soul").style.left = `${OPTION_X[label] - BOX.soul - 6}px`;
  el("soul").style.top = `${rowY(2)}px`;
}

function answer(choice) {
  if (choice === "refuse") play("ominous_cancel.wav");
  else play("ui_select.wav");
  setTimeout(() => window.weird.answer(choice), 120);
}

function onKey(e) {
  if (e.key === "Escape") return answer("refuse");         // always available

  if (job.kind === "complete") {
    if (e.key.toLowerCase() === "z") answer("refuse");     // dismissal only
    return;
  }

  if (beat === 1) {
    if (e.key.toLowerCase() !== "z") return;               // X does nothing here
    if (crawling) return finishCrawl();
    return showChoice();
  }

  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const next = nextIndex(cursor, e.key, job.options.length);
    if (next !== cursor) { moveSoul(next); play("ui_move.wav"); }
    return;
  }
  if (e.key.toLowerCase() === "z") return answer(job.options[cursor] === "Refuse" ? "refuse" : "proceed");
  if (e.key.toLowerCase() === "x") { beat = 1; el("soul").style.display = "none"; drawText(); }
}

// Guarded so `node --test` can import nextIndex without a DOM. Without this
// the interaction test fails at import time, not at assertion time.
if (typeof window !== "undefined" && window.weird) {
  window.weird.onJob(({ job: incoming, assets: assetDir }) => {
    job = incoming;
    assets = assetDir.replace(/\\/g, "/");
    el("face").src = `file://${assets}/noelle/${job.face}.png`;
    el("border").src = `file://${assets}/border.png`;
    el("soul").style.display = "none";
    play(job.sfx === "start" ? "ui_spooky_action.wav" : null);
    drawText(0);
    crawl();
  });

  window.addEventListener("keydown", onKey);
  window.weird.requestJob();
}
```

- [ ] **Step 2: Load it from `box.html`**

Add `<script type="module" src="./box.mjs"></script>` as the last element in the body.

- [ ] **Step 3: Handle a missing asset**

The spec requires that a missing asset never produce a partial box. Add to `main.mjs`, before `win.loadFile`:

```javascript
import { access } from "node:fs/promises";
const ASSETS = join(HERE, "..", "..", "assets");
try {
  await access(join(ASSETS, "noelle", `${job.face}.png`));
  await access(join(ASSETS, "border.png"));
} catch {
  answer("refuse");                    // fail closed, never a half-drawn box
}
```

Audio is exempt: `play()` swallows its own failures, because a missing sound
effect is cosmetic and must not turn into a refusal.

- [ ] **Step 4: Write the interaction test**

```javascript
// tests/box-keys.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { nextIndex } from "../renderer/popup/box.mjs";

test("arrow keys move between two options and clamp at the ends", () => {
  assert.equal(nextIndex(0, "ArrowRight", 2), 1);
  assert.equal(nextIndex(1, "ArrowRight", 2), 1);
  assert.equal(nextIndex(1, "ArrowLeft", 2), 0);
  assert.equal(nextIndex(0, "ArrowLeft", 2), 0);
});
```

Export `nextIndex(current, key, count)` from `box.mjs` as a pure function so the
navigation logic is testable without a browser.

- [ ] **Step 5: Run the suite and verify manually**

Run: `npm test`
Expected: PASS

Run the Step 4 command from Task 7 again. Confirm: text crawls with sound, `Z` skips the crawl, `Z` again reveals the soul, arrows move it with a tick, `Z` on Proceed prints `{"choice":"proceed"}`, `Esc` at any point prints `{"choice":"refuse"}`.

- [ ] **Step 6: Commit**

```bash
git add renderer/popup/box.mjs renderer/popup/box.html tests/box-keys.test.mjs
git commit -m "feat: typewriter, soul navigation, audio and teardown"
```

---

### Task 9: Plugin wiring and TEST_MODE

**Files:**
- Create: `.claude/settings.json` hooks block, `README.md`
- Modify: `src/job.mjs` — honour `TEST_MODE`
- Modify: `.claude/CLAUDE.md` — replace the unrelated "Foxy Jumpscare" content

**Interfaces:**
- Consumes: everything above
- Produces: a working plugin

- [ ] **Step 1: Add TEST_MODE to the job builder**

When `process.env.TEST_MODE` is set, `buildJob` treats **every** tool as consequential and `routeActive` as true. Without this the box only appears on a real gate, and you wait a long time to see your own change.

```javascript
const testMode = () => !!process.env.TEST_MODE;
// in buildJob, first line:
if (!state.routeActive && !testMode()) return null;
// in the PreToolUse branch:
if (!testMode() && !CONSEQUENTIAL_TOOLS.includes(payload.tool_name)) return null;
```

- [ ] **Step 2: Write the test**

```javascript
// append to tests/job.test.mjs
test("TEST_MODE gates every tool and ignores the route flag", () => {
  process.env.TEST_MODE = "1";
  try {
    const job = buildJob({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} },
                         { routeActive: false, autoContinues: 0 });
    assert.ok(job);
  } finally {
    delete process.env.TEST_MODE;
  }
});
```

- [ ] **Step 3: Register the hooks**

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node hooks/gate.mjs" }] }],
    "Stop":       [{ "hooks": [{ "type": "command", "command": "node hooks/gate.mjs" }] }],
    "Notification":[{ "hooks": [{ "type": "command", "command": "node hooks/gate.mjs" }] }]
  }
}
```

- [ ] **Step 4: Verify end to end**

Run: `TEST_MODE=1 claude` in this project, then ask it to read any file.
Expected: the box appears before the tool call. Proceed lets the read happen; Refuse denies it and ends the route.

- [ ] **Step 5: Replace the stale CLAUDE.md and write the README**

`.claude/CLAUDE.md` currently documents an unrelated project. Replace it with this project's invariants: geometry declared once, fail closed, refuse ends the route, assets never committed, no automated model loops.

- [ ] **Step 6: Commit**

```bash
git add .claude/settings.json .claude/CLAUDE.md README.md src/job.mjs tests/job.test.mjs
git commit -m "feat: register hooks, add TEST_MODE, document the plugin"
```

---

## Deferred to Phase 2

The inline terminal renderer. It implements the same stdin/stdout contract as Task 5 consumes, so it drops in behind `askUser` with no change to `src/`. It needs its own design pass.
