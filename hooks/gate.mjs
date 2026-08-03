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
