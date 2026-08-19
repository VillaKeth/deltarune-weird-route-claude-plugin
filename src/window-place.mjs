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

// How wide one physical panel can plausibly be, as a ratio. A single screen
// tops out around 21:9 (2.37); anything appreciably wider is several panels
// stitched into ONE logical display — NVIDIA Surround, AMD Eyefinity, some
// KVMs — and the OS reports the whole stitched desktop as a single display, so
// nothing downstream can tell the panels apart. Measured on the machine this
// was written for: two 1920x1080 DELL SE2425H arrive as one 3840x1080 desktop
// named "WinDisc", with Electron reporting `display count: 1`.
//
// Rounding the ratio is the entire test. 3840x1032 gives 2.09 -> 2 panels; a
// real 3440x1440 ultrawide gives 1.39 -> 1 and is left alone. The threshold
// that falls out is 2.67:1 — above every single-panel aspect in production,
// below any two-panel span.
const PANEL_ASPECT = 16 / 9;

// Exported because it is the load-bearing judgement here, and a wrong answer
// either slices the box down a bezel or splits a screen that has none.
export function panelsIn(area) {
  const w = Math.max(0, finite(area?.width));
  const h = Math.max(0, finite(area?.height));
  if (w === 0 || h === 0) return 1;
  return Math.max(1, Math.round(w / h / PANEL_ASPECT));
}

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
  const { area, size, pos, seed = 0, cursor } = args ?? {};
  const ax = finite(area?.x);
  const ay = finite(area?.y);
  const aw = Math.max(0, finite(area?.width));
  const ah = Math.max(0, finite(area?.height));
  const w = Math.max(0, finite(size?.w));
  const h = Math.max(0, finite(size?.h));

  const right = ax + aw - w - MARGIN;
  const bottom = ay + ah - h - MARGIN;

  // Computed before the anchors, because centre needs to know its panel first.
  const ANCHORS = ["center", "top-left", "top-right", "bottom-left", "bottom-right"];
  const key = ANCHORS.includes(pos) ? pos : "center";

  // Centre is panel-relative; the corners deliberately are not. On a spanned
  // desktop that leaves the left corners meaning the left panel and the right
  // corners the right one, which is the only way left to name a specific
  // screen once the OS has collapsed them into a single display.
  let px = ax;
  let pw = aw;
  const panels = key === "center" ? panelsIn({ width: aw, height: ah }) : 1;
  if (panels > 1) {
    const span = aw / panels;
    // The cursor is the only signal for which panel the user is looking at.
    // Within one spanned display it is finally a meaningful one: the panels
    // share a coordinate space, so cursor x alone identifies the screen.
    // Absent or unusable, panel 0 — a box wholly on the leftmost screen beats
    // a box sliced down the bezel, which is what centring the span produces.
    const cx = Number.isFinite(cursor?.x) ? cursor.x : null;
    const raw = cx === null ? 0 : Math.floor((cx - ax) / span);
    const index = Math.min(Math.max(finite(raw), 0), panels - 1);
    px = ax + Math.round(span * index);
    pw = Math.round(span);
  }

  const anchors = {
    center: [px + Math.round((pw - w) / 2), ay + Math.round((ah - h) / 2)],
    "top-left": [ax + MARGIN, ay + MARGIN],
    "top-right": [right, ay + MARGIN],
    "bottom-left": [ax + MARGIN, bottom],
    "bottom-right": [right, bottom],
  };
  const [baseX, baseY] = anchors[key];
  const [dx, dy] = DIRECTION[key];

  // A negative or absurd seed must still land in a slot rather than throwing or
  // producing a huge offset.
  const slot = Math.abs(Math.trunc(finite(seed))) % CASCADE_WRAP;
  const step = slot * CASCADE;

  return {
    x: clamp(baseX + dx * step, px, pw - w),
    y: clamp(baseY + dy * step, ay, ah - h),
  };
}
