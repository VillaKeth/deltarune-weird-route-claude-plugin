import { readLastAssistantText, extractNext } from "../src/transcript.mjs";
import { loadState, saveState } from "../src/state.mjs";
import { askUser } from "../src/renderer-client.mjs";
import { decide, deny } from "../src/decide.mjs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Overridable so the missing-entry path is testable. Without a seam, the only
// way to exercise it is to delete the real renderer, and a test that depended
// on that file not existing yet broke the moment Task 7 created it.
const RENDERER = process.env.WEIRD_ROUTE_RENDERER_ENTRY
  || join(HERE, "..", "renderer", "popup", "main.mjs");

// Test-only override args. A bare split(" ") cannot express a path containing a
// space — and this project's own checkout path has three of them, so every
// fixture under the repo was unreachable through the override. JSON array is the
// real form; the space-split remains as a convenience for simple values.
const parseArgs = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch { /* not JSON — fall through */ }
  return raw.split(" ").filter(Boolean);
};

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
// WEIRD_ROUTE_RENDERER_CMD can manufacture a Proceed — point it at anything
// that prints {"choice":"proceed"} and every gate allows with no window ever
// appearing. Claude Code's settings support an `env` block injected into every
// hook, so a single approved Write to .claude/settings.local.json would
// otherwise disable the gate silently and permanently. Requiring a separate
// explicit flag means no one arrives here by editing one value, and the stderr
// line means it can never happen quietly.
const devSeamsEnabled = () => {
  if (process.env.WEIRD_ROUTE_DEV !== "1") return false;
  process.stderr.write("weird-route: DEV seams enabled — the gate is stubbable\n");
  return true;
};

const resolveRenderer = () => {
  const override = devSeamsEnabled() ? process.env.WEIRD_ROUTE_RENDERER_CMD : "";
  if (override) {
    return { command: override, args: [...parseArgs(process.env.WEIRD_ROUTE_RENDERER_ARGS), RENDERER] };
  }
  // The entry file is checked before Electron is ever spawned. Measured: with
  // Electron installed but main.mjs absent, Electron does NOT exit — it hangs,
  // and the gated call took 121 s to resolve against the 120 s timeout. It still
  // failed closed, but two minutes per tool call is indistinguishable from a
  // hung terminal. A missing renderer must refuse in milliseconds.
  if (!existsSync(RENDERER)) return null;
  try {
    return { command: createRequire(import.meta.url)("electron"), args: [RENDERER] };
  } catch {
    return null;                            // not installed: every gate refuses
  }
};

const payload = await readStdin();
if (!payload || typeof payload !== "object") {
  // A payload we cannot parse might have been a PreToolUse. Staying silent
  // sends that tool call to the normal permission flow, which on a permissive
  // config is an allow — the fail-open this module exists to prevent. A
  // PreToolUse-shaped deny is ignored by Claude Code for any other event, so
  // emitting it costs nothing and closes the one case that matters.
  process.stdout.write(JSON.stringify(deny()));
  process.exit(0);
}

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
  // decide is guarded and should not reach here — but "never a bare allow" is
  // not the invariant. The invariant is *resolves to Refuse*, and on a
  // permissive permission config an empty output and an allow are the same
  // thing. Deny explicitly when there was a tool call to deny.
  output = payload.hook_event_name === "PreToolUse" ? deny() : {};
  nextState = { ...state, routeActive: false };
}

// Ordering depends on which way the decision fails.
//
// A "block" tells Claude Code to keep going, and the ONLY bound on that is the
// auto-continue counter carried in nextState. If the bump cannot be persisted,
// the counter never advances, atLimit never trips, and the 25-continue ceiling
// stops existing — unbounded free-running with its only backstop gone. So a
// block is persisted FIRST and withheld entirely if the write fails: refusing
// to auto-continue is the safe direction.
//
// Everything else is delivered first. allow/deny are self-contained, and
// saveState can fail on a full disk, a permission error, or lock contention; a
// throw there would lose an already-correct answer, which is the fail-open case.
// A stale counter is the cheaper loss there.
const isBlock = output?.decision === "block";

if (isBlock) {
  try {
    await saveState(sessionId, nextState);
  } catch {
    output = {};                      // never grant a continue we cannot count
  }
}

if (Object.keys(output).length) process.stdout.write(JSON.stringify(output));

if (!isBlock) {
  try {
    await saveState(sessionId, nextState);
  } catch { /* decision already delivered */ }
}

process.exit(0);
