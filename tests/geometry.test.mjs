import test from "node:test";
import assert from "node:assert/strict";
import { BOX, rowY, MAX_CHARS, wrapLines, assertFits, OPTION_X, innerRight } from "../src/geometry.mjs";

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

// The three cases below are regressions. The original algorithm compared the
// fit before adding the continuation indent, so every one of them produced a
// row wider than the box.
test("a word longer than a whole row is hard-broken, never overflowed", () => {
  const rows = wrapLines("Supercalifragilisticexpialidocious is great");
  for (const r of rows) assert.ok(r.length <= 27, `"${r}" is ${r.length} chars`);
});

test("wrapLines never emits an empty row", () => {
  for (const input of [
    "Supercalifragilisticexpialidocious is great",
    "Hi " + "x".repeat(26),
    "* it wants to change PaymentGatewayIntegrationTest.spec.ts.",
  ]) {
    for (const r of wrapLines(input)) assert.notEqual(r, "", `empty row from "${input}"`);
  }
});

test("a realistic long filename stays inside the box", () => {
  const rows = wrapLines("* it wants to change PaymentGatewayIntegrationTest.spec.ts.");
  for (const r of rows) assert.ok(r.length <= 27, `"${r}" is ${r.length} chars`);
  assert.equal(rows.join("").includes("PaymentGatewayIntegration"), true,
    "hard-break must not silently drop characters");
});

test("the continuation indent counts against the budget", () => {
  const rows = wrapLines("Hi " + "x".repeat(26));
  const continuation = rows.slice(1);
  assert.ok(continuation.length > 0);
  for (const r of continuation) assert.ok(r.length <= 27, `"${r}" is ${r.length} chars`);
});

test("assertFits rejects a run past the inner right edge", () => {
  assert.throws(() => assertFits(196, "ThisIsFarTooLongToFit", "Refuse"), /inner right edge/);
  assert.equal(assertFits(196, "Refuse", "Refuse"), 196);
});

// ---------------------------------------------------------------------------
// The choice row.
//
// Beat 2 clears her line and her portrait, so the choice is alone in an
// otherwise empty box. Both renderers inherited positions that were chosen when
// text sat above the options, and measuring a real capture showed what that
// looks like now: 64 px of dead space left of the soul against a 51 px gap
// between the two labels, and 41 px above the glyphs against 20 below.
// ---------------------------------------------------------------------------

const choiceMetrics = () => {
  const innerTop = BOX.border;
  const innerBottom = BOX.height - BOX.border;
  const soulLeft = OPTION_X.Proceed - BOX.soul - BOX.soulGap;
  const proceedEnd = OPTION_X.Proceed + "Proceed".length * BOX.advance;
  const refuseEnd = OPTION_X.Refuse + "Refuse".length * BOX.advance;
  return {
    left: soulLeft - BOX.border,
    gap: OPTION_X.Refuse - proceedEnd,
    right: innerRight - refuseEnd,
    above: BOX.choiceY - innerTop,
    below: innerBottom - (BOX.choiceY + BOX.lineHeight),
  };
};

test("the two options are further apart than they are from the walls", () => {
  // The complaint, stated as geometry: a reader should see two choices with
  // room between them, not two words huddled together in the right half.
  const { left, gap, right } = choiceMetrics();
  assert.ok(gap > left, `gap ${gap} is not wider than the ${left} px left margin`);
  assert.ok(gap > right, `gap ${gap} is not wider than the ${right} px right margin`);
});

test("the choice row sits level in the box, with equal air on both sides", () => {
  const { left, right } = choiceMetrics();
  assert.ok(Math.abs(left - right) <= 4,
    `the row is lopsided: ${left} px left, ${right} px right`);
});

test("the soul never reaches through the frame", () => {
  // Moving Proceed left is bounded: the soul hangs a full soul-width plus the
  // declared gap to its left, and the frame is only BOX.border thick.
  const soulLeft = OPTION_X.Proceed - BOX.soul - BOX.soulGap;
  assert.ok(soulLeft >= BOX.border, `the soul starts at ${soulLeft}, inside the ${BOX.border} px frame`);
});

test("the last option still fits inside the inner right edge", () => {
  const refuseEnd = OPTION_X.Refuse + "Refuse".length * BOX.advance;
  assert.ok(refuseEnd <= innerRight, `Refuse ends at ${refuseEnd}, past ${innerRight}`);
});

test("the lone choice row is centred vertically, not left on the bottom text row", () => {
  // rowY(2) is the third of three text rows. That was right while her line
  // filled the two rows above it; on a screen that has nothing else, it just
  // reads as bottom-heavy.
  const { above, below } = choiceMetrics();
  assert.ok(Math.abs(above - below) <= 1,
    `the row is bottom-heavy: ${above} px above, ${below} px below`);
});
