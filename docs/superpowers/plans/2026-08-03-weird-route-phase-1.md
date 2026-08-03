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

// The three cases below are regressions. The original algorithm compared the
// fit before adding the continuation indent, so every one of them produced a
// row wider than the box.
test("a word longer than a whole row is hard-broken, never overflowed", () => {
  const rows = wrapLines("Supercalifragilisticexpialidocious is great");
  for (const r of rows) assert.ok(r.length <= 27, `"${r}" is ${r.length} chars`);
});

test("wrapLines never emits an empty row", () => {
  for (const input of [
    "Supercalifragilisticexpialidocious is great",
    "Hi " + "x".repeat(26),
    "* it wants to change PaymentGatewayIntegrationTest.spec.ts.",
  ]) {
    for (const r of wrapLines(input)) assert.notEqual(r, "", `empty row from "${input}"`);
  }
});

test("a realistic long filename stays inside the box", () => {
  const rows = wrapLines("* it wants to change PaymentGatewayIntegrationTest.spec.ts.");
  for (const r of rows) assert.ok(r.length <= 27, `"${r}" is ${r.length} chars`);
  assert.equal(rows.join("").includes("PaymentGatewayIntegration"), true,
    "hard-break must not silently drop characters");
});

test("the continuation indent counts against the budget", () => {
  const rows = wrapLines("Hi " + "x".repeat(26));
  const continuation = rows.slice(1);
  assert.ok(continuation.length > 0);
  for (const r of continuation) assert.ok(r.length <= 27, `"${r}" is ${r.length} chars`);
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
    "test": "node --test",
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

const INDENT = "  ";

// Continuation rows carry a two-space indent, so their usable width is two
// less than the first row's. Budgeting both rows identically is what let an
// over-long row escape: the indent was added after the fit check, not before.
// A token too long for an entire row is hard-broken rather than allowed to
// overflow — tool descriptions carry real filenames, which routinely exceed 27.
export function wrapLines(text, { withPortrait = true } = {}) {
  const max = withPortrait ? MAX_CHARS.withPortrait : MAX_CHARS.noPortrait;
  const out = [];
  let cur = "";
  let first = true;

  const budget = () => (first ? max : max - INDENT.length);
  const fits = (s) => s.length <= budget();
  const flush = () => {
    if (cur === "") return;                 // never emit an empty row
    out.push(first ? cur : INDENT + cur);
    first = false;
    cur = "";
  };

  for (const word of text.split(" ")) {
    if (word === "") continue;
    let rest = word;
    if (cur !== "" && !fits(`${cur} ${rest}`)) flush();
    while (!fits(rest)) {
      cur = rest.slice(0, budget());
      rest = rest.slice(budget());
      flush();
    }
    cur = cur === "" ? rest : `${cur} ${rest}`;
  }
  flush();
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

// Regressions. This module's whole contract is that it never throws: the
// caller reads a throw as a crashed hook, which breaks the live session.
test("a structurally useless but syntactically valid line does not throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  for (const [name, junk] of [["null", "null"], ["number", "42"], ["string", '"oops"'], ["array", "[1,2]"]]) {
    const path = join(dir, `${name}.jsonl`);
    await writeFile(path, `${JSON.stringify({ type: "assistant", message: { content: "hi" } })}\n${junk}`);
    assert.equal(await readLastAssistantText(path), "hi", `a bare ${name} line broke the reader`);
  }
});

test("extractNext survives a non-string argument", () => {
  for (const junk of [42, true, [], {}, null, undefined]) {
    assert.equal(extractNext(junk), null, `extractNext(${JSON.stringify(junk)}) should be null`);
  }
});

test("a malformed content block does not throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  const cases = {
    "null-block": { content: [null], expect: "" },
    "number-block": { content: [42], expect: "" },
    "text-then-null": { content: [{ type: "text", text: "a" }, null], expect: "a" },
    "text-missing": { content: [{ type: "text" }], expect: "" },
  };
  for (const [name, { content, expect }] of Object.entries(cases)) {
    const path = join(dir, `${name}.jsonl`);
    await writeFile(path, JSON.stringify({ type: "assistant", message: { content } }));
    assert.equal(await readLastAssistantText(path), expect, `${name} broke the reader`);
  }
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
  // Guard the type, not just falsiness: a truthy non-string has no .matchAll.
  if (typeof text !== "string" || !text) return null;
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
    // JSON.parse("null") succeeds and yields null, so the type check has to
    // survive a line that is syntactically valid but structurally useless.
    // Dereferencing .type here is outside the try/catch above.
    if (!entry || typeof entry !== "object" || entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (typeof content === "string") latest = content;
    else if (Array.isArray(content)) {
      // Blocks are guarded the same way entries are: a null or non-object
      // block would make `.type` and `.text` unguarded dereferences, and
      // nothing here is inside a try/catch.
      latest = content
        .filter((b) => b && typeof b === "object" && b.type === "text")
        .map((b) => (typeof b.text === "string" ? b.text : ""))
        .join("\n");
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

// Regressions. The counter is the only ceiling on free-running: a damaged one
// must never silently remove it. These all failed before sanitisation.
test("a damaged counter on disk loads as zero, not as garbage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  const bodies = {
    "str": '{"routeActive":true,"autoContinues":"5"}',
    "garbage": '{"routeActive":true,"autoContinues":"abc"}',
    "negative": '{"routeActive":true,"autoContinues":-9}',
    "float": '{"routeActive":true,"autoContinues":2.7}',
    "absent": '{"routeActive":true}',
    "notObject": "42",
    "arr": "[]",
  };
  for (const [name, body] of Object.entries(bodies)) {
    await writeFile(join(dir, `${name}.json`), body);
    const state = await loadState(name, dir);
    assert.equal(state.autoContinues, 0, `${name} produced ${state.autoContinues}`);
  }
});

test("bump always yields a usable number", () => {
  for (const junk of ["abc", "5", null, undefined, {}, [], -3, 2.7, NaN]) {
    const next = bump({ routeActive: true, autoContinues: junk }).autoContinues;
    assert.ok(Number.isInteger(next) && next > 0, `bump(${JSON.stringify(junk)}) gave ${next}`);
  }
});

test("the ceiling always becomes reachable, whatever the counter started as", () => {
  for (const junk of ["abc", null, undefined, {}, [], NaN]) {
    let state = { routeActive: true, autoContinues: junk };
    let tripped = false;
    for (let i = 0; i < AUTO_CONTINUE_LIMIT + 5 && !tripped; i++) {
      state = bump(state);
      tripped = atLimit(state);
    }
    assert.ok(tripped, `ceiling never tripped from ${JSON.stringify(junk)}`);
  }
});

test("atLimit fails closed on a counter it cannot trust", () => {
  for (const junk of ["abc", null, undefined, {}, NaN, 2.7]) {
    assert.equal(atLimit({ routeActive: true, autoContinues: junk }), true,
      `atLimit(${JSON.stringify(junk)}) should fail closed`);
  }
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

// The counter is the only ceiling on free-running, so a damaged one must not
// silently disable it. Anything that is not a non-negative integer is treated
// as unusable and reset to 0 on load; atLimit below fails closed if a damaged
// value reaches it in memory anyway.
const sanitiseCount = (value) =>
  Number.isInteger(value) && value >= 0 ? value : 0;

export async function loadState(sessionId, dir = DEFAULT_DIR) {
  try {
    const parsed = JSON.parse(await readFile(pathFor(sessionId, dir), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fresh();
    return {
      routeActive: !!parsed.routeActive,
      autoContinues: sanitiseCount(parsed.autoContinues),
    };
  } catch {
    return fresh();
  }
}

export async function saveState(sessionId, state, dir = DEFAULT_DIR) {
  await mkdir(dir, { recursive: true });
  await writeFile(pathFor(sessionId, dir), JSON.stringify(state), "utf8");
}

export const bump = (state) => ({
  ...state,
  autoContinues: sanitiseCount(state?.autoContinues) + 1,
});

export const reset = (state) => ({ ...state, autoContinues: 0 });

// Fails closed: a counter that is not a usable number is treated as AT the
// limit, so a damaged state file forces the box back rather than removing the
// only ceiling on free-running.
export const atLimit = (state) =>
  !Number.isInteger(state?.autoContinues) || state.autoContinues >= AUTO_CONTINUE_LIMIT;
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

// Regressions. buildJob sits on the fail-closed path: a throw here crashes the
// hook, and a crashed PreToolUse hook can let the tool call through unsupervised.
test("buildJob never throws on a malformed payload", () => {
  const payloads = [
    { hook_event_name: "PreToolUse", tool_name: "Edit" },
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: null },
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: "nope" },
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: null } },
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "" } },
    { hook_event_name: "PreToolUse", tool_name: null, tool_input: {} },
    { hook_event_name: "Nonsense" },
    {},
    null,
    undefined,
  ];
  for (const payload of payloads) {
    assert.doesNotThrow(() => buildJob(payload, active), `threw on ${JSON.stringify(payload)}`);
  }
});

test("buildJob never throws on a malformed state", () => {
  const call = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} };
  for (const state of [null, undefined, 42, "nope", []]) {
    assert.doesNotThrow(() => buildJob(call, state), `threw on state ${JSON.stringify(state)}`);
  }
});

test("describeTool survives a null tool_input", () => {
  for (const tool of CONSEQUENTIAL_TOOLS) {
    assert.doesNotThrow(() => describeTool(tool, null), `${tool} threw on null input`);
    assert.doesNotThrow(() => describeTool(tool, undefined), `${tool} threw on undefined input`);
  }
});

test("a very long path still fits three rows inside the box", () => {
  const job = buildJob({
    hook_event_name: "PreToolUse", tool_name: "Write",
    tool_input: { file_path: `C:/x/${"Segment".repeat(30)}.ts` },
  }, active);
  assert.ok(job.lines.length <= 3, `${job.lines.length} rows`);
  for (const line of job.lines) {
    assert.ok(line.length <= MAX_CHARS.withPortrait, `"${line}" is ${line.length} chars`);
  }
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

export function describeTool(toolName, toolInput) {
  // A default parameter only fires for undefined, never for an explicit null.
  // Hook payloads are external input, and this module sits on the fail-closed
  // path: a throw here crashes the hook, and a crashed PreToolUse hook can let
  // the tool call through unsupervised — the exact inversion of the invariant.
  const input = toolInput && typeof toolInput === "object" ? toolInput : {};
  switch (toolName) {
    case "Write":  return `* it wants to write ${basename(input.file_path)}.`;
    case "Edit":   return `* it wants to change ${basename(input.file_path)}.`;
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
  // Outermost safety boundary: never throw. Returning null means "no box
  // warranted", which leaves Claude Code's own permission flow in charge.
  if (!payload || typeof payload !== "object") return null;
  if (!state || typeof state !== "object") return null;
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

// Regression. A renderer that exits before draining stdin makes the write fail
// asynchronously; streams surface that as an "error" event, which no try/catch
// around .end() can see. Unhandled it is an uncaught exception that takes the
// whole hook process down — and a crashed PreToolUse hook fails OPEN.
test("a renderer that exits without reading stdin does not crash the process", async () => {
  const big = { ...job, lines: Array(60_000).fill("* padding line") };
  assert.equal(
    await askUser(big, { command: process.execPath, args: [FAKE, "proceed"] }),
    "proceed",
  );
});

test("a huge payload to a crashing renderer still fails closed", async () => {
  const big = { ...job, lines: Array(60_000).fill("* padding line") };
  assert.equal(
    await askUser(big, { command: process.execPath, args: [FAKE, "crash"] }),
    "refuse",
  );
});

// Regression. Unbounded stdout is a crash risk in its own right: past V8's max
// string length the concatenation throws from inside the "data" handler, which
// runs on its own event-loop turn and escapes the Promise executor — an
// uncaught exception that crashes the hook and fails OPEN.
test("a renderer flooding stdout is cut off and fails closed", async () => {
  const started = Date.now();
  const choice = await askUser(job, {
    command: process.execPath, args: [FAKE, "flood"], timeoutMs: 30_000,
  });
  assert.equal(choice, "refuse");
  assert.ok(Date.now() - started < 10_000, "should refuse on the cap, not wait for the timeout");
});
```

- [ ] **Step 2: Write the fake renderer fixture**

```javascript
// tests/fixtures/fake-renderer.mjs
const mode = process.argv[2];
if (mode === "flood") { setInterval(() => process.stdout.write("x".repeat(8192)), 1); }
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

// A real answer is `{"choice":"proceed"}` — a few dozen bytes. Anything wildly
// past that is a malfunctioning renderer, and letting `out` grow unbounded is
// itself a crash risk: past V8's max string length `out += chunk` throws a
// RangeError from inside the "data" handler, which runs on its own event-loop
// turn and so escapes the Promise executor entirely. That is an uncaught
// exception, which crashes the hook and fails OPEN.
export const MAX_OUTPUT_BYTES = 64 * 1024;

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
    child.stdout.setEncoding("utf8");     // decode across chunk boundaries
    child.stdout.on("data", (chunk) => {
      if (out.length > MAX_OUTPUT_BYTES) return;   // already refusing; stop growing
      out += chunk;
      if (out.length > MAX_OUTPUT_BYTES) finish("refuse");
    });
    child.on("error", () => finish("refuse"));
    // A renderer that exits before draining stdin makes the write fail
    // asynchronously (EPIPE/EOF). Streams emit that as an "error" event, which
    // the try/catch below cannot see — unhandled, it is an uncaught exception
    // that crashes the hook and fails OPEN. Verified: without this handler, a
    // large job plus a fast-exiting renderer takes the whole process down.
    //
    // It deliberately does NOT resolve. A renderer that answered and exited
    // before draining a large job still gave the user's real answer, and the
    // close handler below honours it; refusing here would race that and throw
    // the answer away. If the write failed and the child then hangs, the
    // timeout is what catches it.
    child.stdin.on("error", () => { /* swallow: close decides the outcome */ });
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

// Regressions. decide is the outermost decision boundary: anything that is not
// an explicit "proceed" must refuse, and nothing here may throw. A value
// falling through to allow() is the fail-open case the plugin exists to prevent.
test("only the exact string proceed is allowed to proceed", async () => {
  const call = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} };
  for (const junk of [undefined, null, "", "Proceed", "PROCEED", "yes", 1, true, {}]) {
    const { output } = await decide(call, active, async () => junk);
    assert.equal(output.hookSpecificOutput?.permissionDecision, "deny",
      `ask() returning ${JSON.stringify(junk)} must deny, not allow`);
  }
});

test("a rejecting ask denies instead of crashing the hook", async () => {
  const call = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} };
  const boom = async () => { throw new Error("renderer exploded"); };
  const { output, nextState } = await decide(call, active, boom);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(nextState.routeActive, false);
});

// Notification hooks have NO decision control in Claude Code — they cannot block
// or modify behaviour. So the box on a Notification decides only the route's own
// fate, and the hook output is always {}. Both branches were previously untested.
test("Notification proceed keeps the route running and emits no decision", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Notification" }, active, proceed);
  assert.deepEqual(output, {}, "Notification output must carry no decision");
  assert.equal(nextState.routeActive, true);
});

test("Notification refuse ends the route and emits no decision", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Notification" }, active, refuse);
  assert.deepEqual(output, {});
  assert.equal(nextState.routeActive, false);
});

test("refusing at the ceiling ends the route and does not block", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Stop", next: "keep going" },
    { routeActive: true, autoContinues: 25 }, refuse);
  assert.equal(output.decision, undefined, "a refusal must never block-and-continue");
  assert.equal(nextState.routeActive, false);
});

test("decide never throws on a malformed payload or state", async () => {
  for (const payload of [null, undefined, 42, "nope", []]) {
    await assert.doesNotReject(() => decide(payload, active, proceed));
  }
  const call = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} };
  for (const state of [null, undefined, 42, "nope"]) {
    await assert.doesNotReject(() => decide(call, state, proceed));
  }
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

// Only the exact string "proceed" proceeds. Anything else — undefined, null, a
// garbage value from a future renderer — is a refusal. Never let an unexpected
// value fall through to allow(): that is the fail-open case this whole module
// exists to prevent, and decide must be safe without trusting its caller.
const normalise = (choice) => (choice === "proceed" ? "proceed" : "refuse");

// A rejecting ask must not propagate: an unhandled rejection here crashes the
// hook, and a crashed PreToolUse hook can let the tool call through.
const safeAsk = async (ask, job) => {
  try {
    return normalise(await ask(job));
  } catch {
    return "refuse";
  }
};

export async function decide(payload, state, ask) {
  // decide is the outermost decision boundary; it must never throw.
  if (!payload || typeof payload !== "object") return { output: {}, nextState: state };
  if (!state || typeof state !== "object") return { output: {}, nextState: state };

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
    await safeAsk(ask, job);                          // dismissal only
    return { output: {}, nextState: { ...state, routeActive: false } };
  }

  const choice = await safeAsk(ask, job);

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

import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, "..", "renderer", "popup", "main.mjs");

// The whole read is guarded, not just the parse: a stream "error" during
// iteration (pipe reset, abnormal parent teardown) throws outside any JSON
// concern, and an uncaught throw here crashes the hook before a decision
// exists at all.
const readStdin = async () => {
  try {
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

// Never shell out to `npx`. On a machine without Electron installed it either
// attempts a large registry fetch or hangs on a non-TTY prompt — from inside a
// hook that fires on every gated tool call. Resolve the local binary instead,
// and refuse outright if it is not there. The env override exists so gate.mjs
// can be driven with a stub renderer in tests.
const resolveRenderer = () => {
  const override = process.env.WEIRD_ROUTE_RENDERER_CMD;
  if (override) {
    return { command: override, args: [...(process.env.WEIRD_ROUTE_RENDERER_ARGS?.split(" ") ?? []), RENDERER] };
  }
  try {
    return { command: createRequire(import.meta.url)("electron"), args: [RENDERER] };
  } catch {
    return null;                            // not installed: every gate refuses
  }
};

const payload = await readStdin();
if (!payload || typeof payload !== "object") process.exit(0);

if (payload.hook_event_name === "Stop") {
  payload.next = extractNext(await readLastAssistantText(payload.transcript_path));
}

const sessionId = payload.session_id ?? "default";
const state = await loadState(sessionId);

const renderer = resolveRenderer();
const ask = renderer ? (job) => askUser(job, renderer) : async () => "refuse";

let output = {};
let nextState = state;
try {
  ({ output, nextState } = await decide(payload, state, ask));
} catch {
  // decide is guarded and should not reach here. If it ever does, emit nothing
  // and let Claude Code's own permission flow stand — never a bare allow.
  output = {};
  nextState = { ...state, routeActive: false };
}

// Deliver the decision BEFORE persisting. saveState touches the filesystem and
// can fail on a full disk, a permission error, or Windows file-lock contention
// between concurrent hook invocations. A throw there would crash the hook after
// the correct answer was already computed but before it was ever printed —
// which is the fail-open case. A stale counter is the cheaper loss.
if (Object.keys(output).length) process.stdout.write(JSON.stringify(output));
try {
  await saveState(sessionId, nextState);
} catch { /* decision already delivered */ }

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

- [ ] **Step 1: Confirm Electron is present**

Run: `node -e "console.log(require('electron'))"`
Expected: an absolute path ending `node_modules\electron\dist\electron.exe`. The
controller already ran `npm install` and pinned `electron@^43.2.0`; do not change
that version. (`^32` was the original pin and carries GHSA-vmqv-hx8q-j7mg, which
has no fix below 43.)

**Measured asset facts.** These were obtained by decoding the PNGs, not assumed.
Build against them; do not re-derive them.

- `assets/border.png` is 297 × 84 RGBA. Along row y = 40 its alpha runs are:
  x 0–3 transparent, x 4–7 opaque, x 8–73 transparent (left portrait slot),
  **x 74–222 opaque** (the text area), x 223–288 transparent (right slot),
  x 289–292 opaque, x 293–296 transparent.
- The four corner dots are **already painted into `border.png`** and are exactly
  `rgb(170,255,230)`. The renderer must NOT draw its own — there is no `#corners`
  element in the markup below for that reason.
- All eight `assets/noelle/*.png` are 56 × 61 RGBA containing exactly two colours:
  `rgb(255,255,255)` fill and `rgb(0,0,0)` outline, over transparency. They are
  two-tone line art. Draw them as-is — **never** apply a CSS tint or filter, which
  would erase the black outlines.

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
// always-on-top window on screen. Deliberately NOT unref'd — the spec calls
// this timer "independent", and an unref'd timer is by definition allowed not
// to fire.
setTimeout(() => answer("refuse"), 120_000);

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

ipcMain.on("ready", () => win.show());
win.on("closed", () => answer("refuse"));

await win.loadFile(join(HERE, "box.html"));
```

Add `rowY` to the geometry import at the top of the file:
`import { BOX, rowY } from "../../src/geometry.mjs";`

```javascript
// renderer/popup/preload.cjs
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("weird", {
  onJob: (fn) => ipcRenderer.on("job", (_e, data) => fn(data)),
  requestJob: () => ipcRenderer.send("job:request"),
  answer: (choice) => ipcRenderer.send("choice", choice),
  ready: () => ipcRenderer.send("ready"),
});
```

- [ ] **Step 3: Write the box markup**

DOM order IS paint order here, and it is load-bearing: the border's cut-out slots
let the face show through, and its opaque block would hide the text if it came
last. Order is **fill → face → border → text → soul**.

```html
<!-- renderer/popup/box.html -->
<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  #box { position: relative; image-rendering: pixelated;
         transform-origin: top left; font-family: "DTM", monospace; color: #fff; }
  #fill   { position: absolute; background: #000; }
  #face, #border { position: absolute; image-rendering: pixelated; }
  #border { left: 0; top: 0; pointer-events: none; }
  .t     { position: absolute; white-space: pre; }
  #soul  { position: absolute; line-height: 0; }
</style>
<div id="box">
  <div id="fill"></div>
  <img id="face" hidden>
  <img id="border">
  <div id="text"></div>
  <div id="soul" hidden></div>
</div>
<script src="./box.mjs"></script>
```

`box.mjs` is a **classic script, not a module** — Chromium refuses ES-module
imports over `file://`, so a `type="module"` tag fails with an opaque CORS error.
Every constant arrives over IPC.

```javascript
// renderer/popup/box.mjs
const $ = (id) => document.getElementById(id);

// The 16x16 Deltarune soul, as measured rects. Drawn rather than shipped as a
// PNG so it needs no asset and scales exactly with the box.
const SOUL_RECTS = [
  [4, 1, 2, 1], [10, 1, 2, 1], [3, 2, 4, 1], [9, 2, 4, 1],
  [2, 3, 12, 5], [3, 8, 10, 2], [4, 10, 8, 1], [5, 11, 6, 1],
  [6, 12, 4, 1], [7, 13, 2, 1],
];

const soulSvg = (size) =>
  `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" width="${size}" height="${size}">` +
  `<g fill="#ff0000">` +
  SOUL_RECTS.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("") +
  `</g></svg>`;

window.weird.onJob(({ job, scale, assets, box, rows }) => {
  const url = (p) => "file:///" + `${assets}/${p}`.replace(/\\/g, "/");

  // Font is injected with an absolute file:// URL. A relative @font-face url in
  // the stylesheet resolves against the page but is unreliable across Chromium's
  // file:// access rules; this form is not.
  const font = new FontFace("DTM", `url("${url("font/DeterminationMonoWeb.woff")}")`);
  const paint = () => {
    const b = $("box");
    b.style.width = `${box.width}px`;
    b.style.height = `${box.height}px`;
    b.style.transform = `scale(${scale})`;
    b.style.fontSize = `${box.fontSize}px`;
    b.style.lineHeight = `${box.lineHeight}px`;

    Object.assign($("fill").style, {
      left: `${box.border}px`, top: `${box.border}px`,
      width: `${box.width - box.border * 2}px`,
      height: `${box.height - box.border * 2}px`,
    });

    const border = $("border");
    border.src = url("border.png");
    border.width = box.width;
    border.height = box.height;

    if (job.face) {
      const face = $("face");
      face.src = url(`noelle/${job.face}.png`);
      // 56x61 sprite centred in the 67x70 slot -> +5,+4. Derived, not hardcoded.
      face.style.left = `${box.slot.x + Math.floor((box.slot.w - 56) / 2)}px`;
      face.style.top = `${box.slot.y + Math.floor((box.slot.h - 61) / 2)}px`;
      face.width = 56; face.height = 61;
      face.hidden = false;
    }

    const textX = job.face ? box.textX.withPortrait : box.textX.noPortrait;
    $("text").innerHTML = job.lines.map((line, i) => {
      // An asterisk row hangs one pixel left; a continuation row does not.
      const x = line.startsWith("*") ? textX + box.asteriskOffset : textX;
      return `<span class="t" style="left:${x}px;top:${rows[i]}px">${
        line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`;
    }).join("");

    window.weird.ready();
  };

  font.load().then((f) => { document.fonts.add(f); paint(); }, paint);
});

window.weird.requestJob();
```

Two details that are easy to get wrong and are asserted in Step 4: the soul is
**not** rendered in this task (there is no interaction yet — `#soul` stays hidden;
`soulSvg` exists for Task 8), and the face offset is *computed* from `box.slot`
rather than written as the literal `12, 11`.

- [ ] **Step 4: Add the capture hook to `main.mjs`**

The render must be *proved*, not eyeballed. Add to `main.mjs`, right after the
existing `ipcMain.on("ready", ...)` — replace that line with:

```javascript
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
```

with `import { writeFile } from "node:fs/promises";` at the top.

- [ ] **Step 5: Write the PNG reader and the render assertions**

`tools/png.mjs` — a minimal 8-bit non-interlaced PNG decoder built on `node:zlib`,
so the assertions need no dependency. It exports
`decodePng(path) -> { w, h, ch, px(x, y) -> {r,g,b,a} }`. Implement IHDR/IDAT
parsing, `inflateSync`, and the five per-scanline filters from PNG spec §9.2
(None/Sub/Up/Average/Paeth).

`tests/render.test.mjs` — spawns Electron against a fixed job, captures, asserts.
This is a `node:test` file like every other suite:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng } from "../tools/png.mjs";
import { BOX, innerRight, rowY } from "../src/geometry.mjs";

const SCALE = 3;
const JOB = {
  kind: "gate", face: "trance",
  lines: ["* Kris... it wants to", "  rewrite 14 files."],
  options: ["Proceed", "Refuse"], default: 0, sfx: null,
};

const capture = () => new Promise((resolve, reject) => {
  const out = join(tmpdir(), `weird-render-${process.pid}.png`);
  const electron = createRequire(import.meta.url)("electron");
  const child = spawn(electron, ["renderer/popup/main.mjs"], {
    env: { ...process.env, WEIRD_ROUTE_CAPTURE: out },
    stdio: ["pipe", "ignore", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (c) => (err += c));
  child.on("close", (code) => {
    try { resolve({ png: decodePng(out), code }); }
    catch (e) { reject(new Error(`no capture (exit ${code}): ${err.slice(0, 400)}`)); }
    finally { rmSync(out, { force: true }); }
  });
  child.stdin.end(JSON.stringify(JOB));
});

const near = (p, r, g, b) => Math.abs(p.r - r) < 6 && Math.abs(p.g - g) < 6 && Math.abs(p.b - b) < 6;

test("the rendered box matches the declared geometry", async () => {
  const { png } = await capture();

  assert.equal(png.w, BOX.width * SCALE);
  assert.equal(png.h, BOX.height * SCALE);

  // The corner dots come from border.png. Correct colour at the correct scaled
  // position proves the border loaded, sits at 0,0 and scaled by exactly SCALE.
  for (const [x, y] of BOX.corners) {
    const p = png.px(x * SCALE + 1, y * SCALE + 1);
    assert.ok(near(p, 170, 255, 230), `corner (${x},${y}) was rgb(${p.r},${p.g},${p.b})`);
  }

  // The face is two-tone line art. Both colours must survive — a CSS tint would
  // erase the black and this assertion is what catches that.
  let black = 0, white = 0;
  for (let y = BOX.slot.y * SCALE; y < (BOX.slot.y + BOX.slot.h) * SCALE; y++) {
    for (let x = BOX.slot.x * SCALE; x < (BOX.slot.x + BOX.slot.w) * SCALE; x++) {
      const p = png.px(x, y);
      if (p.a < 128) continue;
      if (near(p, 255, 255, 255)) white++;
      else if (near(p, 0, 0, 0)) black++;
    }
  }
  assert.ok(white > 200, `face has ${white} white px — sprite did not load`);
  assert.ok(black > 200, `face has ${black} black px — outlines lost, sprite was tinted`);

  // Row 0 must contain glyphs, and they must be inside the opaque text block
  // (measured at x 74..222). Anything in the right portrait slot is overflow.
  const band = (from, to) => {
    let lit = 0;
    for (let y = rowY(0) * SCALE; y < (rowY(0) + BOX.lineHeight) * SCALE; y++)
      for (let x = from * SCALE; x < to * SCALE; x++)
        if (near(png.px(x, y), 255, 255, 255)) lit++;
    return lit;
  };
  assert.ok(band(74, 223) > 100, "row 0 has no glyphs — the font did not load");
  assert.equal(band(223, innerRight), 0, "text overflowed past the text block");
});
```

- [ ] **Step 6: Run the render test**

Run: `npm test`
Expected: all suites pass, including `the rendered box matches the declared geometry`.
A failure here names the exact assertion, which is the point — do not weaken an
assertion to make it pass. If the font does not load, fix the URL; if the corners
are wrong, fix the scale.

- [ ] **Step 7: Look at it once**

Run: `node tools/show-box.mjs`

```javascript
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
```

Expected: a centred, always-on-top, transparent-backed box; Noelle in the left
slot; text legible and inside the frame. Close it — stdout prints
`{"choice":"refuse"}`.

- [ ] **Step 8: Commit**

Stage only the paths this task created. Never `git add -A` — an earlier task swept
an unrelated untracked tree into its commit.

```bash
git add renderer/popup/ tools/png.mjs tools/show-box.mjs tests/render.test.mjs
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
