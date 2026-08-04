// Where the popup window goes on a desktop that may have several displays.
//
// This lived inline in renderer/popup/main.mjs, which node --test cannot
// import — the same trap that kept box.mjs unverifiable. It is arithmetic on
// four numbers and a rectangle, so it belongs where the tests can reach it.
//
// It owns no pixel values of its own. The window size and the work area are
// both passed in; geometry.mjs still declares the box.

// The gap between the box and the edge of the screen for the corner
// placements. Not a box dimension — it is a property of this placement policy,
// which is why it is declared here and not in geometry.mjs.
export const MARGIN = 24;

// How far each successive box on one screen is offset from the last.
export const CASCADE = 28;
export const CASCADE_WRAP = 6;

// Which way a cascade travels, per anchor. A box anchored to the bottom-right
// has MARGIN of room left before the screen edge, so stepping down-right walks
// it straight off the display — and off the display means onto the neighbouring
// monitor, which is the whole failure this file exists to prevent. Every corner
// therefore cascades INWARD, away from the edge it is anchored to.
const DIRECTION = {
  center: [1, 1],
  "top-left": [1, 1],
  "top-right": [-1, 1],
  "bottom-left": [1, -1],
  "bottom-right": [-1, -1],
};

const finite = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

// Clamped to the work area on BOTH sides. Clamping only the left and top edge
// was the actual defect: it kept a box from sliding off to the left while
// leaving it free to slide off to the right.
//
// When the window is larger than the display, lo > hi and the window is pinned
// to the origin — the top-left corner is the part worth keeping on screen.
const clamp = (v, lo, span) => {
  const hi = lo + span;
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
};

// area   {x, y, width, height} — a display's workArea. x and y are REQUIRED and
//        may be negative: a display to the left of the primary one has a
//        negative origin, which is why nothing here clamps against zero.
// size   {w, h} — the window.
// pos    a key of DIRECTION; anything else is treated as center.
// seed   any integer (the pid, in production). Decides the cascade slot.
export function placeWindow(args) {
  // Read off a plain object rather than destructuring the parameter: a default
  // value covers `undefined` and not `null`, and `placeWindow(null)` threw.
  const { area, size, pos, seed = 0 } = args ?? {};
  const ax = finite(area?.x);
  const ay = finite(area?.y);
  const aw = Math.max(0, finite(area?.width));
  const ah = Math.max(0, finite(area?.height));
  const w = Math.max(0, finite(size?.w));
  const h = Math.max(0, finite(size?.h));

  const right = ax + aw - w - MARGIN;
  const bottom = ay + ah - h - MARGIN;

  const anchors = {
    center: [ax + Math.round((aw - w) / 2), ay + Math.round((ah - h) / 2)],
    "top-left": [ax + MARGIN, ay + MARGIN],
    "top-right": [right, ay + MARGIN],
    "bottom-left": [ax + MARGIN, bottom],
    "bottom-right": [right, bottom],
  };

  const key = Object.hasOwn(anchors, pos) ? pos : "center";
  const [baseX, baseY] = anchors[key];
  const [dx, dy] = DIRECTION[key];

  // A negative or absurd seed must still land in a slot rather than throwing or
  // producing a huge offset.
  const slot = Math.abs(Math.trunc(finite(seed))) % CASCADE_WRAP;
  const step = slot * CASCADE;

  return {
    x: clamp(baseX + dx * step, ax, aw - w),
    y: clamp(baseY + dy * step, ay, ah - h),
  };
}
