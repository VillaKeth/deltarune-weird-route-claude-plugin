import test from "node:test";
import assert from "node:assert/strict";
import { buildJob, describeTool, CONSEQUENTIAL_TOOLS } from "../src/job.mjs";
import { MAX_CHARS, MAX_ROWS } from "../src/geometry.mjs";

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

test("no box with options ever speaks on the choice row", () => {
  // The choice row IS row 2, and text and options are drawn by separate passes
  // at the same coordinates. The start box wrapped to three rows and the third
  // was painted underneath Proceed/Refuse. Every assertion in the suite passed
  // through it, because nothing compared the two passes against each other.
  const jobs = [
    buildJob({ hook_event_name: "UserPromptSubmit", prompt: "weird route" },
             { routeActive: false, autoContinues: 0 }),
    buildJob({ hook_event_name: "Notification" }, active),
    buildJob({ hook_event_name: "Stop", next: "keep going" },
             { routeActive: true, autoContinues: 25 }),
    ...CONSEQUENTIAL_TOOLS.map((tool) => buildJob(
      { hook_event_name: "PreToolUse", tool_name: tool,
        tool_input: { file_path: "/a/".repeat(90) + "deep.ts", command: "x".repeat(400),
                      url: "https://example.com/" + "y".repeat(400), description: "z".repeat(400) } },
      active)),
  ];

  for (const job of jobs) {
    assert.ok(job, "expected a box");
    assert.ok(job.options.length > 0, "these all offer a choice");
    assert.ok(job.lines.length <= MAX_ROWS - 1,
      `${job.kind}/${job.face} speaks ${job.lines.length} rows: ${JSON.stringify(job.lines)}`);
  }
});

test("the route-complete box may use every row, having no choice to collide with", () => {
  const job = buildJob({ hook_event_name: "Stop", next: null }, active);
  assert.equal(job.options.length, 0);
  assert.ok(job.lines.length <= MAX_ROWS);
});

test("describeTool names the file for an edit", () => {
  const [verb, detail] = describeTool("Edit", { file_path: "C:\\proj\\src\\auth.ts" });
  assert.match(verb, /change/);
  assert.match(detail, /auth\.ts/);
});

test("the box shows WHICH thing it is approving, not just the kind", () => {
  // "it wants to run a command" told the user nothing, and basename() alone
  // made C:\Windows\System32\drivers\etc\hosts and ./notes/hosts identical.
  const [, cmd] = describeTool("Bash", { command: "rm -rf build && npm ci" });
  assert.match(cmd, /rm -rf build/);

  const [, url] = describeTool("WebFetch", { url: "https://example.com/a/b" });
  assert.match(url, /example\.com/);

  const system = describeTool("Write", { file_path: "C:\\Windows\\System32\\drivers\\etc\\hosts" })[1];
  const notes = describeTool("Write", { file_path: "./notes/hosts" })[1];
  assert.notEqual(system, notes, "two different paths must not render identically");
  assert.match(system, /System32|drivers|etc/, "the distinguishing part must survive");
});

test("describeTool truncates rather than overflowing, keeping the telling end", () => {
  const deep = "/a/very/long/path/that/keeps/going/" + "x".repeat(200) + "/target.ts";
  const [, detail] = describeTool("Write", { file_path: deep });
  assert.ok(detail.length <= (MAX_CHARS.withPortrait - 2) * 2, `detail was ${detail.length} chars`);
  assert.match(detail, /target\.ts$/, "a path keeps its end");

  const long = "git log --oneline " + "y".repeat(300);
  const [, cmd] = describeTool("Bash", { command: long });
  assert.match(cmd, /^git log --oneline/, "a command keeps its start");
});

test("describeTool reports empty inputs rather than rendering nothing", () => {
  assert.equal(describeTool("Bash", { command: "   " })[1], "(nothing)");
  assert.equal(describeTool("Write", {})[1], "(nothing)");
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

test("buildJob never throws on a malformed payload", () => {
  const payloads = [
    { hook_event_name: "PreToolUse", tool_name: "Edit" },
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: null },
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: "nope" },
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: null } },
    { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "" } },
    { hook_event_name: "PreToolUse", tool_name: null, tool_input: {} },
    { hook_event_name: "Nonsense" },
    {},
    null,
    undefined,
  ];
  for (const payload of payloads) {
    assert.doesNotThrow(() => buildJob(payload, active), `threw on ${JSON.stringify(payload)}`);
  }
});

test("buildJob never throws on a malformed state", () => {
  const call = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} };
  for (const state of [null, undefined, 42, "nope", []]) {
    assert.doesNotThrow(() => buildJob(call, state), `threw on state ${JSON.stringify(state)}`);
  }
});

test("describeTool survives a null tool_input", () => {
  for (const tool of CONSEQUENTIAL_TOOLS) {
    assert.doesNotThrow(() => describeTool(tool, null), `${tool} threw on null input`);
    assert.doesNotThrow(() => describeTool(tool, undefined), `${tool} threw on undefined input`);
  }
});

test("a very long path still fits three rows inside the box", () => {
  const job = buildJob({
    hook_event_name: "PreToolUse", tool_name: "Write",
    tool_input: { file_path: `C:/x/${"Segment".repeat(30)}.ts` },
  }, active);
  assert.ok(job.lines.length <= 3, `${job.lines.length} rows`);
  for (const line of job.lines) {
    assert.ok(line.length <= MAX_CHARS.withPortrait, `"${line}" is ${line.length} chars`);
  }
});
