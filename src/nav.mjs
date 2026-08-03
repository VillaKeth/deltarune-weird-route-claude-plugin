// Interaction rules for the box, as pure functions.
//
// These live in the main process rather than the page because the page cannot
// import: Chromium refuses ES-module imports over file://, so anything loaded
// by box.html has to be a classic script with no imports and no exports — and
// therefore nothing `node --test` can reach. Keeping the rules here means the
// whole interaction is unit-testable without a browser, and the renderer stays
// a dumb painter that draws what it is told.

// Re-exported for convenience; declared in geometry.mjs, which owns every pixel.
export { OPTION_X } from "./geometry.mjs";

// One character per tick. Deltarune's crawl is not instant and the sound is
// per character, so this doubles as the voice cadence.
export const CRAWL_MS = 35;

export const totalChars = (lines = []) =>
  lines.reduce((n, line) => n + (typeof line === "string" ? line.length : 0), 0);

export function nextIndex(current, key, count) {
  if (!Number.isInteger(count) || count < 1) return 0;
  const at = Number.isInteger(current) ? current : 0;
  if (key === "ArrowRight") return Math.min(at + 1, count - 1);
  if (key === "ArrowLeft") return Math.max(at - 1, 0);
  return at;
}

const NOTHING = Object.freeze({ type: "none" });

// The single source of truth for what a keypress does. `state` is
// { kind, beat, cursor, crawling, options }; the return is an intent for the
// caller to carry out, never a mutation.
//
// Escape is checked first and unconditionally: the spec requires the window
// always be closable, so no other rule may shadow it.
export function keyAction(state, rawKey) {
  if (typeof rawKey !== "string" || rawKey === "") return NOTHING;
  const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
  const options = Array.isArray(state?.options) ? state.options : [];

  if (key === "Escape") return { type: "answer", choice: "refuse" };

  // The route-complete box carries no options — it is an acknowledgement, and
  // dismissing it is not a refusal of anything.
  if (state?.kind === "complete") {
    return key === "z" || key === "Enter" ? { type: "answer", choice: "refuse" } : NOTHING;
  }

  if (state?.beat === 1) {
    if (key !== "z") return NOTHING;              // X does not skip her
    return state?.crawling ? { type: "skip" } : { type: "choice" };
  }

  if (key === "x") return { type: "back" };

  // With no options there is nothing to move between and nothing to confirm.
  // Z here must REFUSE, not proceed: reading a label out of an empty list
  // yields undefined, and "undefined is not Refuse, therefore proceed" is a
  // fail-open — damaged state would grant permission. Caught by its own test.
  if (options.length === 0) {
    return key === "z" ? { type: "answer", choice: "refuse" } : NOTHING;
  }

  if (key === "ArrowLeft" || key === "ArrowRight") {
    const at = Number.isInteger(state?.cursor) ? state.cursor : 0;
    const to = nextIndex(at, key, options.length);
    return to === at ? NOTHING : { type: "move", to };
  }
  if (key === "z") {
    const label = options[Number.isInteger(state?.cursor) ? state.cursor : 0];
    // Only an exact "Proceed" proceeds. Anything else — a renamed label, an
    // out-of-range cursor, a truncated list — refuses.
    return { type: "answer", choice: label === "Proceed" ? "proceed" : "refuse" };
  }
  return NOTHING;
}
