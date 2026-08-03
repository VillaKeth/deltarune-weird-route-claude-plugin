import { test } from "node:test";
import assert from "node:assert/strict";
import { nextIndex, keyAction, totalChars, OPTION_X, CRAWL_MS } from "../src/nav.mjs";
import { assertFits } from "../src/geometry.mjs";

const gate = (over = {}) => ({
  kind: "gate", beat: 2, cursor: 0, crawling: false,
  options: ["Proceed", "Refuse"], ...over,
});

test("arrow keys move between two options and clamp at the ends", () => {
  assert.equal(nextIndex(0, "ArrowRight", 2), 1);
  assert.equal(nextIndex(1, "ArrowRight", 2), 1);
  assert.equal(nextIndex(1, "ArrowLeft", 2), 0);
  assert.equal(nextIndex(0, "ArrowLeft", 2), 0);
});

test("nextIndex survives damaged input rather than returning NaN", () => {
  assert.equal(nextIndex(undefined, "ArrowRight", 2), 1);
  assert.equal(nextIndex("x", "ArrowLeft", 2), 0);
  assert.equal(nextIndex(0, "ArrowRight", 0), 0);
  assert.equal(nextIndex(0, "Enter", 2), 0);
});

test("totalChars ignores non-string rows", () => {
  assert.equal(totalChars(["abc", "de"]), 5);
  assert.equal(totalChars([]), 0);
  assert.equal(totalChars(), 0);
  assert.equal(totalChars(["ab", null, 7]), 2);
});

test("Escape always refuses, in every beat and every kind", () => {
  for (const state of [gate(), gate({ beat: 1, crawling: true }), gate({ kind: "complete" })]) {
    assert.deepEqual(keyAction(state, "Escape"), { type: "answer", choice: "refuse" });
  }
});

test("beat 1: Z skips the crawl, then Z opens the choice, and X does nothing", () => {
  assert.deepEqual(keyAction(gate({ beat: 1, crawling: true }), "z"), { type: "skip" });
  assert.deepEqual(keyAction(gate({ beat: 1, crawling: false }), "z"), { type: "choice" });
  assert.deepEqual(keyAction(gate({ beat: 1, crawling: true }), "x"), { type: "none" });
  assert.deepEqual(keyAction(gate({ beat: 1 }), "ArrowLeft"), { type: "none" });
});

test("Z is accepted regardless of shift state", () => {
  assert.deepEqual(keyAction(gate({ beat: 1 }), "Z"), { type: "choice" });
  assert.deepEqual(keyAction(gate({ cursor: 1 }), "Z"), { type: "answer", choice: "refuse" });
});

test("beat 2: Z answers according to where the soul is", () => {
  assert.deepEqual(keyAction(gate({ cursor: 0 }), "z"), { type: "answer", choice: "proceed" });
  assert.deepEqual(keyAction(gate({ cursor: 1 }), "z"), { type: "answer", choice: "refuse" });
});

test("beat 2: a move that changes nothing reports nothing", () => {
  assert.deepEqual(keyAction(gate({ cursor: 0 }), "ArrowRight"), { type: "move", to: 1 });
  assert.deepEqual(keyAction(gate({ cursor: 1 }), "ArrowRight"), { type: "none" });
  assert.deepEqual(keyAction(gate({ cursor: 0 }), "ArrowLeft"), { type: "none" });
});

test("X returns to her line", () => {
  assert.deepEqual(keyAction(gate(), "x"), { type: "back" });
});

test("the route-complete box takes only a dismissal, and it is not a refusal of a choice", () => {
  const done = gate({ kind: "complete", options: [] });
  assert.deepEqual(keyAction(done, "z"), { type: "answer", choice: "refuse" });
  assert.deepEqual(keyAction(done, "Enter"), { type: "answer", choice: "refuse" });
  assert.deepEqual(keyAction(done, "ArrowRight"), { type: "none" });
  assert.deepEqual(keyAction(done, "x"), { type: "none" });
});

test("garbage keys and damaged state never throw", () => {
  for (const k of ["", null, undefined, 42, {}]) {
    assert.deepEqual(keyAction(gate(), k), { type: "none" });
  }
  assert.doesNotThrow(() => keyAction(null, "z"));
  assert.doesNotThrow(() => keyAction({}, "ArrowRight"));
  assert.deepEqual(keyAction({ beat: 2, options: null }, "ArrowRight"), { type: "none" });
});

test("damaged options fail closed rather than proceeding", () => {
  // Reading a label out of an empty list gives undefined, and treating
  // "not Refuse" as proceed would let damaged state grant permission.
  assert.deepEqual(keyAction({ beat: 2, cursor: 0, options: [] }, "z"),
    { type: "answer", choice: "refuse" });
  assert.deepEqual(keyAction({ beat: 2, cursor: 9, options: ["Proceed", "Refuse"] }, "z"),
    { type: "answer", choice: "refuse" }, "an out-of-range cursor must not proceed");
  assert.deepEqual(keyAction({ beat: 2, cursor: 0, options: ["Continue", "Refuse"] }, "z"),
    { type: "answer", choice: "refuse" }, "only an exact 'Proceed' proceeds");
});

test("both option labels fit inside the box at their declared positions", () => {
  for (const [label, x] of Object.entries(OPTION_X)) {
    assert.doesNotThrow(() => assertFits(x, label, label));
  }
});

test("the crawl cadence is a positive number of milliseconds", () => {
  assert.ok(Number.isFinite(CRAWL_MS) && CRAWL_MS > 0);
});
