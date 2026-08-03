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
