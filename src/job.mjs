import { wrapLines, MAX_ROWS } from "./geometry.mjs";
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
