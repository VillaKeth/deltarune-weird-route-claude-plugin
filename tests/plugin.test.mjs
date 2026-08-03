import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The plugin manifest is the only part of this project that Claude Code reads
// without executing any of it, so nothing else in the suite can catch a typo in
// it. A wrong path here does not throw — the hook simply never runs, and the
// gate silently ceases to exist. That is the fail-open the whole project is
// written to prevent, arriving through the one file no test covered.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const EVENTS = ["UserPromptSubmit", "PreToolUse", "Stop", "Notification"];

test("the plugin manifest declares a valid name", () => {
  const manifest = read(".claude-plugin/plugin.json");
  assert.match(manifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, "name must be kebab-case");
});

test("the manifest version matches the package version", () => {
  assert.equal(read(".claude-plugin/plugin.json").version, read("package.json").version);
});

test("the marketplace offers the plugin that is actually here", () => {
  const market = read(".claude-plugin/marketplace.json");
  const manifest = read(".claude-plugin/plugin.json");
  const entry = market.plugins.find((p) => p.name === manifest.name);
  assert.ok(entry, `marketplace offers ${market.plugins.map((p) => p.name)}, not ${manifest.name}`);
  assert.ok(existsSync(join(ROOT, entry.source, ".claude-plugin", "plugin.json")),
    `source ${entry.source} holds no plugin manifest`);
});

test("hooks.json registers every event the gate handles", () => {
  const { hooks } = read("hooks/hooks.json");
  assert.deepEqual(Object.keys(hooks).sort(), [...EVENTS].sort());
});

test("every registered hook points at a file that actually exists", () => {
  const { hooks } = read("hooks/hooks.json");
  let checked = 0;
  for (const event of EVENTS) {
    for (const group of hooks[event]) {
      for (const hook of group.hooks) {
        assert.equal(hook.type, "command");
        // Exec form: the script is an argument, not part of a shell string, so
        // the path needs no quoting and survives the three spaces in this
        // project's own directory name.
        assert.ok(Array.isArray(hook.args), `${event} must use exec form`);
        const target = hook.args.find((a) => a.includes("gate.mjs"));
        assert.ok(target, `${event} does not invoke the gate`);
        assert.ok(target.startsWith("${CLAUDE_PLUGIN_ROOT}/"),
          `${event} uses ${target}, which is not relative to the plugin root`);
        const onDisk = join(ROOT, target.replace("${CLAUDE_PLUGIN_ROOT}/", ""));
        assert.ok(existsSync(onDisk), `${event} points at ${onDisk}, which does not exist`);
        checked++;
      }
    }
  }
  assert.equal(checked, EVENTS.length, "expected exactly one hook per event");
});

test("the gate is given longer than the renderer's own failsafe to answer", () => {
  // The window force-closes and refuses at 120 s. A hook timeout below that
  // would kill the gate mid-decision, and Claude Code treats a killed hook as
  // no answer at all — which is the fail-open case.
  const { hooks } = read("hooks/hooks.json");
  for (const event of EVENTS) {
    for (const group of hooks[event]) {
      for (const hook of group.hooks) {
        assert.ok(hook.timeout > 120, `${event} times out at ${hook.timeout}s, inside the 120s failsafe`);
      }
    }
  }
});

test("PreToolUse matches every tool, and the matcherless events declare no matcher", () => {
  const { hooks } = read("hooks/hooks.json");
  for (const group of hooks.PreToolUse) {
    assert.ok(group.matcher === "*" || group.matcher === "" || group.matcher === undefined,
      `PreToolUse matcher ${JSON.stringify(group.matcher)} would gate only some tools`);
  }
  // UserPromptSubmit, Stop and Notification take no matcher. One declared here
  // is ignored rather than rejected, so it would read as a filter that is not.
  for (const event of ["UserPromptSubmit", "Stop", "Notification"]) {
    for (const group of hooks[event]) {
      assert.equal(group.matcher, undefined, `${event} declares a matcher, which is ignored`);
    }
  }
});
