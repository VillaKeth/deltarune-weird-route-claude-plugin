import { spawn } from "node:child_process";

export const RENDER_TIMEOUT_MS = 120_000;

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
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", () => finish("refuse"));
    // A renderer that exits before draining stdin makes the write fail
    // asynchronously (EPIPE/EOF). Streams emit that as an "error" event, which
    // the try/catch below cannot see — unhandled, it is an uncaught exception
    // that crashes the hook and fails OPEN. Verified: without this line, a
    // large job plus a fast-exiting renderer takes the whole process down.
    child.stdin.on("error", () => {
      // Prevent uncaught exception - just swallow the error, don't resolve
    });
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
