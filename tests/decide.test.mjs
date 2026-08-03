// tests/decide.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/decide.mjs";

const active = { routeActive: true, autoContinues: 0 };
const proceed = async () => "proceed";
const refuse = async () => "refuse";

test("proceed allows a gated tool call", async () => {
  const { output } = await decide(
    { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, active, proceed);
  assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
});

test("refuse denies the tool call", async () => {
  const { output } = await decide(
    { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, active, refuse);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
});

test("refuse ends the route", async () => {
  const { nextState } = await decide(
    { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, active, refuse);
  assert.equal(nextState.routeActive, false);
});

test("a silent auto-continue blocks the stop and increments the counter", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Stop", next: "keep going" },
    { routeActive: true, autoContinues: 4 }, proceed);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /keep going/);
  assert.equal(nextState.autoContinues, 5);
});

test("proceeding at the limit resets the counter", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Stop", next: "keep going" },
    { routeActive: true, autoContinues: 25 }, proceed);
  assert.equal(output.decision, "block");
  assert.equal(nextState.autoContinues, 0);
});

test("the completion box ends the route and does not block", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Stop", next: null }, active, proceed);
  assert.equal(output.decision, undefined);
  assert.equal(nextState.routeActive, false);
});

test("an ungated tool passes through untouched", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }, active, refuse);
  assert.deepEqual(output, {});
  assert.deepEqual(nextState, active);
});

// Regressions. decide is the outermost decision boundary: anything that is not
// an explicit "proceed" must refuse, and nothing here may throw. A value
// falling through to allow() is the fail-open case the plugin exists to prevent.
test("only the exact string proceed is allowed to proceed", async () => {
  const call = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} };
  for (const junk of [undefined, null, "", "Proceed", "PROCEED", "yes", 1, true, {}]) {
    const { output } = await decide(call, active, async () => junk);
    assert.equal(output.hookSpecificOutput?.permissionDecision, "deny",
      `ask() returning ${JSON.stringify(junk)} must deny, not allow`);
  }
});

test("a rejecting ask denies instead of crashing the hook", async () => {
  const call = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} };
  const boom = async () => { throw new Error("renderer exploded"); };
  const { output, nextState } = await decide(call, active, boom);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(nextState.routeActive, false);
});

// Notification hooks have NO decision control in Claude Code — they cannot block
// or modify behaviour. So the box on a Notification decides only the route's own
// fate, and the hook output is always {}. Both branches were previously untested.
test("Notification proceed keeps the route running and emits no decision", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Notification" }, active, proceed);
  assert.deepEqual(output, {}, "Notification output must carry no decision");
  assert.equal(nextState.routeActive, true);
});

test("Notification refuse ends the route and emits no decision", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Notification" }, active, refuse);
  assert.deepEqual(output, {});
  assert.equal(nextState.routeActive, false);
});

test("refusing at the ceiling ends the route and does not block", async () => {
  const { output, nextState } = await decide(
    { hook_event_name: "Stop", next: "keep going" },
    { routeActive: true, autoContinues: 25 }, refuse);
  assert.equal(output.decision, undefined, "a refusal must never block-and-continue");
  assert.equal(nextState.routeActive, false);
});

test("decide never throws on a malformed payload or state", async () => {
  for (const payload of [null, undefined, 42, "nope", []]) {
    await assert.doesNotReject(() => decide(payload, active, proceed));
  }
  const call = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} };
  for (const state of [null, undefined, 42, "nope"]) {
    await assert.doesNotReject(() => decide(call, state, proceed));
  }
});
