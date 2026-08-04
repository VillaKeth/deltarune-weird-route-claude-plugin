import { test } from "node:test";
import assert from "node:assert/strict";
import { placeWindow, MARGIN, CASCADE_WRAP } from "../src/window-place.mjs";
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
