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
