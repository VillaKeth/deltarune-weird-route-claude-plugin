import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTO_CONTINUE_LIMIT, loadState, saveState, bump, atLimit, reset } from "../src/state.mjs";

test("the ceiling is 25", () => {
  assert.equal(AUTO_CONTINUE_LIMIT, 25);
});

test("an unknown session starts inactive at zero", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  assert.deepEqual(await loadState("nope", dir), { routeActive: false, autoContinues: 0 });
});

test("state round-trips through disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  await saveState("s1", { routeActive: true, autoContinues: 3 }, dir);
  assert.deepEqual(await loadState("s1", dir), { routeActive: true, autoContinues: 3 });
});

test("bump does not mutate its input", () => {
  const before = { routeActive: true, autoContinues: 1 };
  const after = bump(before);
  assert.equal(before.autoContinues, 1);
  assert.equal(after.autoContinues, 2);
});

test("atLimit trips at exactly 25, not before", () => {
  assert.equal(atLimit({ routeActive: true, autoContinues: 24 }), false);
  assert.equal(atLimit({ routeActive: true, autoContinues: 25 }), true);
  assert.equal(atLimit({ routeActive: true, autoContinues: 26 }), true);
});

test("reset clears the counter but leaves the route running", () => {
  assert.deepEqual(reset({ routeActive: true, autoContinues: 25 }),
                   { routeActive: true, autoContinues: 0 });
});

// Regressions. The counter is the only ceiling on free-running: a damaged one
// must never silently remove it. These all failed before sanitisation.
test("a damaged counter on disk loads as zero, not as garbage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-"));
  const bodies = {
    "str": '{"routeActive":true,"autoContinues":"5"}',
    "garbage": '{"routeActive":true,"autoContinues":"abc"}',
    "negative": '{"routeActive":true,"autoContinues":-9}',
    "float": '{"routeActive":true,"autoContinues":2.7}',
    "absent": '{"routeActive":true}',
    "notObject": "42",
    "arr": "[]",
  };
  for (const [name, body] of Object.entries(bodies)) {
    await writeFile(join(dir, `${name}.json`), body);
    const state = await loadState(name, dir);
    assert.equal(state.autoContinues, 0, `${name} produced ${state.autoContinues}`);
  }
});

test("bump always yields a usable number", () => {
  for (const junk of ["abc", "5", null, undefined, {}, [], -3, 2.7, NaN]) {
    const next = bump({ routeActive: true, autoContinues: junk }).autoContinues;
    assert.ok(Number.isInteger(next) && next > 0, `bump(${JSON.stringify(junk)}) gave ${next}`);
  }
});

test("the ceiling always becomes reachable, whatever the counter started as", () => {
  for (const junk of ["abc", null, undefined, {}, [], NaN]) {
    let state = { routeActive: true, autoContinues: junk };
    let tripped = false;
    for (let i = 0; i < AUTO_CONTINUE_LIMIT + 5 && !tripped; i++) {
      state = bump(state);
      tripped = atLimit(state);
    }
    assert.ok(tripped, `ceiling never tripped from ${JSON.stringify(junk)}`);
  }
});

test("atLimit fails closed on a counter it cannot trust", () => {
  for (const junk of ["abc", null, undefined, {}, NaN, 2.7]) {
    assert.equal(atLimit({ routeActive: true, autoContinues: junk }), true,
      `atLimit(${JSON.stringify(junk)}) should fail closed`);
  }
});
