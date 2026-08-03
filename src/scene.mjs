// The inline scene, as a reducer.
//
// The renderer owns the console, the timers and the process; this owns what the
// box IS at any moment. Splitting them means the whole interaction — every
// beat, every key, every answer — is reachable by node --test without a
// terminal, which is the thing the popup renderer never managed.
import { totalChars, keyAction } from "./nav.mjs";
import { layout } from "./cells.mjs";

export function initialState(job) {
  const lines = Array.isArray(job?.lines) ? job.lines : [];
  return {
    kind: job?.kind,
    options: Array.isArray(job?.options) ? job.options : [],
    beat: 1,
    revealed: 0,
    cursor: Number.isInteger(job?.default) ? job.default : 0,
    total: totalChars(lines),
  };
}

// nav.mjs asks for `crawling`; it is derived, so it is computed here rather
// than stored, where it could fall out of step with `revealed`.
const withCrawling = (state) => ({ ...state, crawling: state.revealed < state.total });

// One key. Returns the next state and, if the scene is over, the answer.
// Never mutates its input and never throws: this sits on the fail-closed path,
// and an exception here would leave the renderer with no decision to deliver.
export function applyKey(state, key) {
  if (!state || typeof state !== "object") return { state, answer: "refuse", changed: false };

  let action;
  try {
    action = keyAction(withCrawling(state), key);
  } catch {
    return { state, answer: "refuse", changed: false };
  }

  switch (action.type) {
    case "skip":
      return { state: { ...state, revealed: state.total }, answer: null, changed: true };
    case "choice":
      return { state: { ...state, beat: 2 }, answer: null, changed: true };
    case "back":
      return { state: { ...state, beat: 1 }, answer: null, changed: true };
    case "move":
      return { state: { ...state, cursor: action.to }, answer: null, changed: true };
    case "answer":
      return { state, answer: action.choice === "proceed" ? "proceed" : "refuse", changed: false };
    default:
      return { state, answer: null, changed: false };
  }
}

// One typewriter tick.
export const tick = (state) =>
  state.revealed >= state.total ? state : { ...state, revealed: state.revealed + 1 };

// Where the box sits on screen. Centred, like the popup's default placement.
export function place(job, term) {
  const box = layout(term, { withFace: !!job?.face });
  return {
    box,
    origin: {
      row: Math.max(1, Math.floor((term.rows - box.height) / 2) + 1),
      col: Math.max(1, Math.floor((term.cols - box.width) / 2) + 1),
    },
  };
}

export { withCrawling };
