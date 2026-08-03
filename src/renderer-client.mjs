import { spawn } from "node:child_process";

export const RENDER_TIMEOUT_MS = 120_000;

// A real answer is `{"choice":"proceed"}` — a few dozen bytes. Anything wildly
// past that is a malfunctioning renderer, and letting `out` grow unbounded is
// itself a crash risk: past V8's max string length `out += chunk` throws a
// RangeError from inside the "data" handler, which runs on its own event-loop
// turn and so escapes the Promise executor entirely. That is an uncaught
// exception, which crashes the hook and fails OPEN.
export const MAX_OUTPUT_BYTES = 64 * 1024;

// Every failure path returns "refuse". A gate that fails open silently hands
// Claude unrestricted tool access, which is worse than the plugin not working.
export function askUser(job, { command, args = [], timeoutMs = RENDER_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      resolve(choice === "proceed" ? "proceed" : "refuse");
    };

    let child;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return resolve("refuse");
    }

    const timer = setTimeout(() => finish("refuse"), timeoutMs);

    let out = "";
    child.stdout.setEncoding("utf8");     // decode across chunk boundaries
    child.stdout.on("data", (chunk) => {
      if (out.length > MAX_OUTPUT_BYTES) return;   // already refusing; stop growing
      out += chunk;
      if (out.length > MAX_OUTPUT_BYTES) finish("refuse");
    });
    child.on("error", () => finish("refuse"));
    // A renderer that exits before draining stdin makes the write fail
    // asynchronously (EPIPE/EOF). Streams emit that as an "error" event, which
    // the try/catch below cannot see — unhandled, it is an uncaught exception
    // that crashes the hook and fails OPEN. Verified: without this handler, a
    // large job plus a fast-exiting renderer takes the whole process down.
    //
    // It deliberately does NOT resolve. A renderer that answered and exited
    // before draining a large job still gave the user's real answer, and the
    // close handler below honours it; refusing here would race that and throw
    // the answer away. If the write failed and the child then hangs, the
    // timeout is what catches it.
    child.stdin.on("error", () => { /* swallow: close decides the outcome */ });
    child.on("close", (code) => {
      if (code !== 0) return finish("refuse");
      try {
        finish(JSON.parse(out).choice);
      } catch {
        finish("refuse");
      }
    });

    try {
      child.stdin.end(JSON.stringify(job));
    } catch {
      finish("refuse");
    }
  });
}
