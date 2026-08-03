import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
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
