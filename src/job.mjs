import { wrapLines, MAX_ROWS, MAX_CHARS, BOX, innerRight } from "./geometry.mjs";
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

// A box with options owns only the rows ABOVE the choice row, so the detail
// gets exactly one row. It used to be budgeted for two, which is how a
// three-row line ended up painted underneath Proceed/Refuse.
const DETAIL_BUDGET = MAX_CHARS.withPortrait;

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

// The choice row IS row 2. Text and options are drawn by separate passes at the
// same coordinates, so anything she says on row 2 ends up underneath Proceed and
// Refuse — which is exactly what happened: the start box wrapped to three rows
// and the third one collided with the choice. A box carrying options therefore
// owns only rows 0-1; only the route-complete box, which has no choice, gets all
// three. SPEAK_ROWS makes that reservation explicit rather than incidental.
export const SPEAK_ROWS = Object.freeze({ withOptions: MAX_ROWS - 1, alone: MAX_ROWS });

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

const speak = (maxRows, ...paragraphs) =>
  paragraphs.flatMap((p) => wrapLines(p)).slice(0, maxRows).map(clamp);

// Every box that offers a choice speaks through this, so the reservation cannot
// be forgotten at one call site the way it was at all of them.
const speakAbove = (...paragraphs) => speak(SPEAK_ROWS.withOptions, ...paragraphs);

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
      // Two rows, deliberately. The old copy wrapped to three and collided.
      lines: speakAbove("* Kris.", "* let's finish this."),
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
      lines: speakAbove(...describeTool(payload.tool_name, payload.tool_input)),
      options: ["Proceed", "Refuse"],
      default: 0,
      sfx: null,
    };
  }

  if (payload.hook_event_name === "Notification") {
    return {
      kind: "gate",
      face: "mortified",
      lines: speakAbove("* Kris... it's waiting for you."),
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
        // No options, so this one may use all three rows.
        lines: speak(SPEAK_ROWS.alone, "* ...it's done, Kris."),
        options: [],
        default: 0,
        sfx: null,
      };
    }
    if (atLimit(state)) {
      return {
        kind: "gate",
        face: "mortified_stare",
        lines: speakAbove("* Kris... how long has it been?"),
        options: ["Proceed", "Refuse"],
        default: 0,
        sfx: null,
      };
    }
    return null;
  }

  return null;
}
