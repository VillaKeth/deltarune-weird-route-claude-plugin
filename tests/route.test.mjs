// Route activation and TEST_MODE. Without a way to start, routeActive stays
// false forever and the plugin can never fire a single box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJob, isRouteTrigger } from "../src/job.mjs";
import { decide } from "../src/decide.mjs";

const OFF = { routeActive: false, autoContinues: 0 };
const ON = { routeActive: true, autoContinues: 0 };
const prompt = (text) => ({ hook_event_name: "UserPromptSubmit", prompt: text });

test("the trigger matches the phrases a user would actually type", () => {
  for (const s of ["weird route", "/weird-route", "Weird Route", "let's do the weird route",
                   "/weird route", "WEIRD-ROUTE"]) {
    assert.ok(isRouteTrigger(s), `should trigger: ${s}`);
  }
});

test("the trigger does not fire on ordinary prompts", () => {
  for (const s of ["fix the router", "weird bug in the route handler", "reroute this",
                   "", null, undefined, 42, {}]) {
    assert.ok(!isRouteTrigger(s), `should NOT trigger: ${JSON.stringify(s)}`);
  }
});

test("a trigger while the route is off offers to start it", () => {
  const job = buildJob(prompt("let's run the weird route"), OFF);
  assert.equal(job.kind, "start");
  assert.equal(job.sfx, "start", "the start jingle is part of the spec");
  assert.deepEqual(job.options, ["Proceed", "Refuse"]);
});

test("a trigger while the route is already running does nothing", () => {
  assert.equal(buildJob(prompt("weird route"), ON), null);
});

test("an ordinary prompt never gates", () => {
  assert.equal(buildJob(prompt("add a test"), OFF), null);
  assert.equal(buildJob(prompt("add a test"), ON), null);
});

test("Proceed on the start box turns the route on; Refuse leaves it off", async () => {
  const started = await decide(prompt("weird route"), OFF, async () => "proceed");
  assert.equal(started.nextState.routeActive, true);
  assert.equal(started.nextState.autoContinues, 0);
  // UserPromptSubmit carries no permission decision, but it is the only channel
  // that can reach the model, so the NEXT: convention rides out with it.
  assert.equal(started.output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(started.output.hookSpecificOutput.additionalContext, /NEXT:/);
  assert.equal(started.output.hookSpecificOutput.permissionDecision, undefined);

  const declined = await decide(prompt("weird route"), OFF, async () => "refuse");
  assert.equal(declined.nextState.routeActive, false);
  assert.deepEqual(declined.output, {});
});

test("a renderer failure on the start box leaves the route off", async () => {
  const r = await decide(prompt("weird route"), OFF, async () => { throw new Error("boom"); });
  assert.equal(r.nextState.routeActive, false, "a crashed box must not start the route");
});

test("with the route off, nothing else gates", () => {
  assert.equal(buildJob({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: {} }, OFF), null);
  assert.equal(buildJob({ hook_event_name: "Stop", next: "keep going" }, OFF), null);
  assert.equal(buildJob({ hook_event_name: "Notification" }, OFF), null);
});

test("TEST_MODE gates every tool and ignores the route flag", (t) => {
  process.env.TEST_MODE = "1";
  t.after(() => { delete process.env.TEST_MODE; });

  const job = buildJob({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }, OFF);
  assert.ok(job, "TEST_MODE must gate a Read with the route off");
  assert.equal(job.kind, "gate");
});

test("without TEST_MODE a Read never gates, even with the route on", () => {
  assert.equal(buildJob({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }, ON), null);
});
