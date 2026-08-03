import test from "node:test";
import assert from "node:assert/strict";
import { buildJob, describeTool, CONSEQUENTIAL_TOOLS } from "../src/job.mjs";
import { MAX_CHARS } from "../src/geometry.mjs";

const active = { routeActive: true, autoContinues: 0 };

test("read-only tools never raise a box", () => {
  for (const tool of ["Read", "Grep", "Glob"]) {
    const job = buildJob({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: {} }, active);
    assert.equal(job, null, `${tool} should not gate`);
  }
});

test("consequential tools always raise a box", () => {
  for (const tool of CONSEQUENTIAL_TOOLS) {
    const job = buildJob({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: {} }, active);
    assert.ok(job, `${tool} should gate`);
    assert.deepEqual(job.options, ["Proceed", "Refuse"]);
    assert.equal(job.kind, "gate");
  }
});

test("every generated line fits the box", () => {
  const job = buildJob(
    { hook_event_name: "PreToolUse", tool_name: "Bash",
      tool_input: { command: "rm -rf ./build && npm run build && npm publish --access public" } },
    active);
  for (const line of job.lines) {
    assert.ok(line.length <= MAX_CHARS.withPortrait, `"${line}" is ${line.length} chars`);
  }
  assert.ok(job.lines.length <= 3);
});

test("describeTool names the file for an edit", () => {
  const line = describeTool("Edit", { file_path: "C:\\\\proj\\\\src\\\\auth.ts" });
  assert.match(line, /auth\.ts/);
});

test("a Stop with the counter at the limit raises a gate box", () => {
  const job = buildJob({ hook_event_name: "Stop", next: "keep refactoring" },
                       { routeActive: true, autoContinues: 25 });
  assert.ok(job);
  assert.equal(job.kind, "gate");
});

test("a Stop below the limit with a NEXT marker raises no box", () => {
  const job = buildJob({ hook_event_name: "Stop", next: "keep refactoring" },
                       { routeActive: true, autoContinues: 3 });
  assert.equal(job, null);
});

test("a Stop with no NEXT marker raises a choiceless completion box", () => {
  const job = buildJob({ hook_event_name: "Stop", next: null }, active);
  assert.ok(job);
  assert.equal(job.kind, "complete");
  assert.deepEqual(job.options, []);
  assert.equal(job.sfx, null);
});

test("nothing gates when the route is not running", () => {
  const idle = { routeActive: false, autoContinues: 0 };
  assert.equal(buildJob({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, idle), null);
});
