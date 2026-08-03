import test from "node:test";
import assert from "node:assert/strict";
import { BOX, rowY, MAX_CHARS, wrapLines, assertFits } from "../src/geometry.mjs";

test("box constants match the spec", () => {
  assert.equal(BOX.width, 297);
  assert.equal(BOX.height, 84);
  assert.equal(BOX.border, 7);
  assert.equal(BOX.advance, 8);
  assert.deepEqual(BOX.slot, { x: 7, y: 7, w: 67, h: 70 });
  assert.equal(BOX.textX.withPortrait, 69);
  assert.equal(BOX.textX.noPortrait, 11);
});

test("rows sit at 7, 25, 43", () => {
  assert.deepEqual([0, 1, 2].map(rowY), [7, 25, 43]);
});

test("line budgets are derived, not hardcoded guesses", () => {
  assert.equal(MAX_CHARS.withPortrait, 27);
  assert.equal(MAX_CHARS.noPortrait, 34);
});

test("wrapLines never exceeds the budget", () => {
  const rows = wrapLines("* Kris... it wants to rewrite 14 files.");
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.ok(r.length <= 27, `"${r}" is ${r.length} chars`);
});

test("wrapLines indents continuation rows by two", () => {
  const rows = wrapLines("* Kris... it wants to rewrite 14 files.");
  assert.equal(rows[0].startsWith("*"), true);
  for (const r of rows.slice(1)) assert.equal(r.startsWith("  "), true);
});

test("assertFits rejects a run past the inner right edge", () => {
  assert.throws(() => assertFits(196, "ThisIsFarTooLongToFit", "Refuse"), /inner right edge/);
  assert.equal(assertFits(196, "Refuse", "Refuse"), 196);
});
