import { test } from "node:test";
import assert from "node:assert/strict";
import { placeWindow, panelsIn, MARGIN, CASCADE_WRAP } from "../src/window-place.mjs";
import { BOX } from "../src/geometry.mjs";

// The real window, at the scale it actually opens at.
const SIZE = { w: BOX.width * BOX.scale, h: BOX.height * BOX.scale };   // 891 x 252

const POSITIONS = ["center", "top-left", "top-right", "bottom-left", "bottom-right"];

// The display this was developed on. Small enough that the box plus a full
// cascade genuinely runs out of room, which is what makes it a useful case.
const SMALL = { x: 0, y: 0, width: 1280, height: 672 };
// A display to the LEFT of the primary one. Its origin is negative — the case
// that made clamping against zero wrong.
const LEFT = { x: -1920, y: 0, width: 1920, height: 1040 };
// A display below and to the right, so both origins are positive and non-zero.
const RIGHT = { x: 1280, y: 200, width: 2560, height: 1360 };

const fits = ({ x, y }, area) =>
  x >= area.x && y >= area.y &&
  x + SIZE.w <= area.x + area.width &&
  y + SIZE.h <= area.y + area.height;

test("the box lands wholly on the target display, at every position and every cascade slot", () => {
  // The old placement clamped the left and top edges only, so a box could still
  // slide off to the right — and off the right edge means onto the neighbouring
  // monitor, which is the bug this whole module exists for. Every combination
  // is checked because the failure only appeared at the far cascade slots.
  for (const area of [SMALL, LEFT, RIGHT]) {
    for (const pos of POSITIONS) {
      for (let seed = 0; seed < CASCADE_WRAP * 2; seed++) {
        const at = placeWindow({ area, size: SIZE, pos, seed });
        assert.ok(fits(at, area),
          `${pos} seed ${seed} on ${area.width}x${area.height}@${area.x},${area.y} ` +
          `put the box at ${at.x},${at.y} — ${at.x + SIZE.w},${at.y + SIZE.h} is outside`);
      }
    }
  }
});

test("the specific overflow that shipped: bottom-right at the far cascade slot", () => {
  // Guarding the general rule above is not enough — a regression test should
  // fail for the original reason. The old code computed
  // x = max(area.x, right + slot*28) with right = 1280-891-24 = 365, giving
  // x = 505 at slot 5 and a right edge of 1396 on a 1280-wide screen.
  const at = placeWindow({ area: SMALL, size: SIZE, pos: "bottom-right", seed: 5 });
  assert.ok(at.x + SIZE.w <= SMALL.width, `right edge ${at.x + SIZE.w} past ${SMALL.width}`);
  assert.ok(at.y + SIZE.h <= SMALL.height, `bottom edge ${at.y + SIZE.h} past ${SMALL.height}`);
});

test("a display left of the primary one keeps the box on itself, not at zero", () => {
  // Clamping to zero would drag the box back across to the primary display,
  // which is the same visible symptom as the original workAreaSize bug.
  for (const pos of POSITIONS) {
    const at = placeWindow({ area: LEFT, size: SIZE, pos, seed: 0 });
    assert.ok(at.x < 0, `${pos} placed the box at x=${at.x}, off its own display`);
  }
});

test("corner placements cascade inward, away from the edge they are anchored to", () => {
  // A bottom-right box has MARGIN of room before the screen edge. Stepping
  // down-right would spend that in one slot and then clamp, stacking every
  // later box in the same place — the exact thing the cascade prevents.
  const first = placeWindow({ area: RIGHT, size: SIZE, pos: "bottom-right", seed: 0 });
  const later = placeWindow({ area: RIGHT, size: SIZE, pos: "bottom-right", seed: 3 });
  assert.ok(later.x < first.x, `x went ${first.x} -> ${later.x}, not inward`);
  assert.ok(later.y < first.y, `y went ${first.y} -> ${later.y}, not inward`);
});

test("every cascade slot is a distinct position, so stacked boxes stay reachable", () => {
  // Two tool calls in one assistant block open two boxes. Only the focused one
  // can be answered, so exact overlap strands the other until its failsafe.
  for (const pos of POSITIONS) {
    const seen = new Set();
    for (let seed = 0; seed < CASCADE_WRAP; seed++) {
      const { x, y } = placeWindow({ area: RIGHT, size: SIZE, pos, seed });
      seen.add(`${x},${y}`);
    }
    assert.equal(seen.size, CASCADE_WRAP, `${pos} produced ${seen.size} distinct slots`);
  }
});

test("a window larger than the display is pinned to the origin, not pushed off it", () => {
  // lo > hi in the clamp. The top-left corner is the part worth keeping, since
  // that is where the portrait and the first row of text are.
  const tiny = { x: 100, y: 50, width: 400, height: 200 };
  for (const pos of POSITIONS) {
    const at = placeWindow({ area: tiny, size: SIZE, pos, seed: 4 });
    assert.deepEqual(at, { x: 100, y: 50 }, `${pos} did not pin to the display origin`);
  }
});

test("an unknown position is centred rather than dropped", () => {
  const named = placeWindow({ area: RIGHT, size: SIZE, pos: "center", seed: 2 });
  for (const pos of [undefined, "", "middle", "TOP-LEFT", "__proto__", "toString"]) {
    assert.deepEqual(placeWindow({ area: RIGHT, size: SIZE, pos, seed: 2 }), named,
      `pos=${String(pos)} did not fall back to center`);
  }
});

test("placement never throws, whatever it is handed", () => {
  // It runs on the path that opens the window. A throw here is a box that never
  // appears, and a gate with no box is a gate that cannot be answered.
  const junk = [
    undefined, null, {}, { area: null, size: null },
    { area: { x: NaN, y: NaN, width: NaN, height: NaN }, size: SIZE },
    { area: SMALL, size: { w: -1, h: -1 }, seed: -7 },
    { area: SMALL, size: SIZE, seed: Number.POSITIVE_INFINITY },
    { area: { x: "0", y: "0", width: "800", height: "600" }, size: SIZE },
  ];
  for (const args of junk) {
    const at = placeWindow(args);
    assert.ok(Number.isFinite(at.x) && Number.isFinite(at.y),
      `${JSON.stringify(args)} produced ${at.x},${at.y}`);
  }
});

test("the margin is honoured at the corners when there is room for it", () => {
  const at = placeWindow({ area: RIGHT, size: SIZE, pos: "top-left", seed: 0 });
  assert.deepEqual(at, { x: RIGHT.x + MARGIN, y: RIGHT.y + MARGIN });
});

// ---------------------------------------------------------------------------
// Spanned displays.
//
// NVIDIA Surround, AMD Eyefinity and some KVMs stitch several physical panels
// into ONE logical display. Measured on the machine this was written for: two
// DELL SE2425H on a Quadro P1000, reported by both Windows and Electron as a
// single 3840x1080 desktop named "WinDisc" — display count 1, not 2. The
// cursor-proxy code that picks a display therefore never gets a choice, and
// "centre" centres across the SPAN, which is the bezel. At this size that put
// 445 px of the box on the left panel and 446 px on the right.
// ---------------------------------------------------------------------------

// A 48 px taskbar, as measured — workArea, not bounds.
const SPAN2 = { x: 0, y: 0, width: 3840, height: 1032 };
const SPAN3 = { x: 0, y: 0, width: 5760, height: 1032 };
// A span whose origin is negative, the case that made clamping against zero wrong.
const SPAN_LEFT = { x: -3840, y: 0, width: 3840, height: 1032 };
// A genuine single ultrawide. 21:9 is one panel and must NOT be split.
const ULTRAWIDE = { x: 0, y: 0, width: 3440, height: 1392 };

const panelOf = (area, i, n) => ({
  x: area.x + Math.round((area.width / n) * i),
  y: area.y,
  width: Math.round(area.width / n),
  height: area.height,
});

test("a spanned desktop counts its panels, and a single display counts one", () => {
  assert.equal(panelsIn(SPAN2), 2);
  assert.equal(panelsIn(SPAN3), 3);
  assert.equal(panelsIn(SPAN_LEFT), 2);
  // The regression that matters most: a 21:9 and a 16:9 are ONE panel each.
  assert.equal(panelsIn(ULTRAWIDE), 1);
  assert.equal(panelsIn(SMALL), 1);
  assert.equal(panelsIn(LEFT), 1);
  assert.equal(panelsIn(RIGHT), 1);
});

test("centre on a spanned desktop puts the box inside one panel, not across the seam", () => {
  // The actual bug: x = round((3840-891)/2) = 1475, and the bezel is at 1920.
  const at = placeWindow({ area: SPAN2, size: SIZE, pos: "center", seed: 0, cursor: { x: 2500, y: 500 } });
  assert.ok(at.x >= 1920, `box starts at ${at.x}, left of the seam at 1920`);
  assert.ok(at.x + SIZE.w <= 3840, `box ends at ${at.x + SIZE.w}, past the desktop`);
});

test("the cursor decides which panel the box lands on", () => {
  const left = placeWindow({ area: SPAN2, size: SIZE, pos: "center", seed: 0, cursor: { x: 100, y: 500 } });
  const right = placeWindow({ area: SPAN2, size: SIZE, pos: "center", seed: 0, cursor: { x: 3000, y: 500 } });
  assert.ok(fits(left, panelOf(SPAN2, 0, 2)), `cursor on panel 0 placed the box at ${left.x}`);
  assert.ok(fits(right, panelOf(SPAN2, 1, 2)), `cursor on panel 1 placed the box at ${right.x}`);
});

test("every cascade slot stays inside the chosen panel", () => {
  // Clamping to the whole span would let the cascade walk the box over the
  // bezel, which is the same visible failure the corner cascade bug produced.
  for (let seed = 0; seed < CASCADE_WRAP * 2; seed++) {
    const at = placeWindow({ area: SPAN2, size: SIZE, pos: "center", seed, cursor: { x: 2500, y: 500 } });
    assert.ok(fits(at, panelOf(SPAN2, 1, 2)), `seed ${seed} put the box at ${at.x}, outside panel 1`);
  }
});

test("a three-panel span picks the panel the cursor is on, not the middle one", () => {
  // Deliberately the OUTER panel. Centring a three-panel span across the whole
  // desktop already lands in the middle panel by accident, so a middle-panel
  // assertion passes without the feature and proves nothing.
  const at = placeWindow({ area: SPAN3, size: SIZE, pos: "center", seed: 0, cursor: { x: 5000, y: 500 } });
  assert.ok(fits(at, panelOf(SPAN3, 2, 3)), `box at ${at.x} is not inside the third panel`);
});

test("a span left of the primary display keeps the box on its own panel", () => {
  const at = placeWindow({ area: SPAN_LEFT, size: SIZE, pos: "center", seed: 0, cursor: { x: -1000, y: 500 } });
  assert.ok(fits(at, panelOf(SPAN_LEFT, 1, 2)), `box at ${at.x} is not on the right panel of a negative-origin span`);
});

test("a cursor outside the desktop still lands the box on a real panel", () => {
  for (const x of [-99999, 99999, 3840, -1]) {
    const at = placeWindow({ area: SPAN2, size: SIZE, pos: "center", seed: 0, cursor: { x, y: 0 } });
    const onOne = fits(at, panelOf(SPAN2, 0, 2)) || fits(at, panelOf(SPAN2, 1, 2));
    assert.ok(onOne, `cursor x=${x} put the box at ${at.x}, straddling or off the desktop`);
  }
});

test("with no cursor the box still lands wholly on one panel rather than on the bezel", () => {
  // No signal is not a reason to slice the box in half. Panel 0 is the choice.
  const at = placeWindow({ area: SPAN2, size: SIZE, pos: "center", seed: 0 });
  assert.ok(fits(at, panelOf(SPAN2, 0, 2)), `box at ${at.x} is not wholly on panel 0`);
});

test("an ultrawide is centred across the whole panel, exactly as before", () => {
  // 3440x1392 is 2.47:1 — one physical screen. Splitting it would be a
  // regression for every ultrawide owner, and there is no bezel to avoid.
  const at = placeWindow({ area: ULTRAWIDE, size: SIZE, pos: "center", seed: 0, cursor: { x: 3000, y: 500 } });
  assert.equal(at.x, ULTRAWIDE.x + Math.round((ULTRAWIDE.width - SIZE.w) / 2));
});

test("corner placements still span the whole desktop, so they can reach either panel", () => {
  // Deliberately NOT panel-relative: on a span, left corners are the left
  // panel and right corners are the right one, which is a useful way to ask
  // for a specific screen by name.
  const left = placeWindow({ area: SPAN2, size: SIZE, pos: "top-left", seed: 0, cursor: { x: 3000, y: 500 } });
  const right = placeWindow({ area: SPAN2, size: SIZE, pos: "top-right", seed: 0, cursor: { x: 100, y: 500 } });
  assert.equal(left.x, SPAN2.x + MARGIN);
  assert.equal(right.x, SPAN2.x + SPAN2.width - SIZE.w - MARGIN);
});

test("span placement never throws on a junk cursor", () => {
  const junk = [null, {}, { x: NaN, y: NaN }, { x: "1000" }, { x: Infinity, y: 0 }, "nope", 42];
  for (const cursor of junk) {
    const at = placeWindow({ area: SPAN2, size: SIZE, pos: "center", seed: 0, cursor });
    assert.ok(Number.isFinite(at.x) && Number.isFinite(at.y),
      `cursor ${JSON.stringify(cursor)} produced ${at.x},${at.y}`);
  }
});
