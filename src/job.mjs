import { wrapLines, MAX_ROWS, MAX_CHARS, BOX, INDENT, innerRight } from "./geometry.mjs";
import { atLimit } from "./state.mjs";

export const CONSEQUENTIAL_TOOLS = ["Write", "Edit", "Bash", "WebFetch", "Task"];

// TEST_MODE makes every tool consequential and ignores the route flag, so the
// box can be seen in seconds instead of by waiting for a real gate.
const testMode = () => !!process.env.TEST_MODE;

// The route has to be able to start. Without a trigger, routeActive is false
// forever, buildJob returns null for everything, and the plugin can never fire
// a single box — which is how the plan left it.
export const ROUTE_TRIGGER = /(?:^\s*\/?weird[-\s]?route\b)|(?:\bweird route\b)/i;

export const isRouteTrigger = (prompt) =>
  typeof prompt === "string" && ROUTE_TRIGGER.test(prompt);

// The detail is spoken as a continuation of the verb above it, so every row it
// occupies is indented. Two of those rows sit under a one-row verb, which is the
// whole box.
const DETAIL_BUDGET = (MAX_CHARS.withPortrait - INDENT.length) * 2;

// A path's identity is at its END — basename alone made
// C:\Windows\System32\drivers\etc\hosts and ./notes/hosts render identically.
const tail = (value, budget = DETAIL_BUDGET) => {
  const s = String(value ?? "").replace(/\\/g, "/").trim();
  if (!s) return "(nothing)";
  return s.length <= budget ? s : `…${s.slice(-(budget - 1))}`;
};

// A command's identity is at its START.
const head = (value, budget = DETAIL_BUDGET) => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "(nothing)";
  return s.length <= budget ? s : `${s.slice(0, budget - 1)}…`;
};

// Returns the rows Noelle speaks: a verb, then the specific thing. The box is
// asking for informed consent, so it must name what it is approving — "it wants
// to run a command" told the user nothing at all.
export function describeTool(toolName, toolInput) {
  // A default parameter only fires for undefined, never for an explicit null.
  // Hook payloads are external input, and this module sits on the fail-closed
  // path: a throw here crashes the hook, and a crashed PreToolUse hook can let
  // the tool call through unsupervised — the exact inversion of the invariant.
  const input = toolInput && typeof toolInput === "object" ? toolInput : {};
  switch (toolName) {
    case "Write":    return ["* it wants to write", tail(input.file_path)];
    case "Edit":     return ["* it wants to change", tail(input.file_path)];
    case "Bash":     return ["* it wants to run", head(input.command)];
    case "WebFetch": return ["* it wants to reach", tail(input.url)];
    case "Task":     return ["* it wants to send someone", head(input.description ?? input.prompt)];
    default:         return [`* it wants to use ${String(toolName ?? "something")}.`];
  }
}

// The spec requires that no run pass the inner right edge. Enforced here, where
// the rows are built, rather than in the renderer — but by CLAMPING, never by
// throwing. assertFits throws, and a throw inside buildJob crashes the hook,
// and a crashed PreToolUse hook lets the tool call through: enforcing the
// cosmetic rule must not break the safety one. The clamp is unreachable while
// wrapLines is correct; it exists so that a future bug there is a short line
// rather than an open gate.
const clamp = (row) => {
  const x = BOX.textX.withPortrait + (row.startsWith("*") ? BOX.asteriskOffset : 0);
  const room = Math.max(0, Math.floor((innerRight - x) / BOX.advance));
  return row.length <= room ? row : row.slice(0, room);
};

// Every box gets all three rows. Beat 2 clears her line and shows nothing but
// the choice, so text and options never occupy the box at the same time and no
// row has to be held back for them.
//
// A paragraph opening with "*" is a new sentence and starts at the margin.
// Anything else continues the paragraph above it, and is indented to align with
// that sentence's text rather than with its asterisk.
const speak = (...paragraphs) =>
  paragraphs
    .flatMap((p) => wrapLines(p, { continuation: !p.startsWith("*") }))
    .slice(0, MAX_ROWS)
    .map(clamp);

export function buildJob(payload, state) {
  // Outermost safety boundary: never throw. Returning null means "no box
  // warranted", which leaves Claude Code's own permission flow in charge.
  if (!payload || typeof payload !== "object") return null;
  if (!state || typeof state !== "object") return null;

  // Starting the route is the one gate that fires while the route is off.
  if (payload.hook_event_name === "UserPromptSubmit") {
    if (state.routeActive) return null;              // already running
    if (!isRouteTrigger(payload.prompt)) return null;
    return {
      kind: "start",
      face: "trance",
      lines: speak("* Kris.", "* let's finish what we started."),
      options: ["Proceed", "Refuse"],
      default: 0,
      sfx: "start",
    };
  }

  if (!state.routeActive && !testMode()) return null;

  if (payload.hook_event_name === "PreToolUse") {
    if (!testMode() && !CONSEQUENTIAL_TOOLS.includes(payload.tool_name)) return null;
    return {
      kind: "gate",
      face: "trance",
      lines: speak(...describeTool(payload.tool_name, payload.tool_input)),
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
