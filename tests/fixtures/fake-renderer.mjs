// Stub renderer. The branches MUST be an else-if chain: as a run of bare `if`s
// the "flood" case fell through to the trailing else, printed {"choice":"flood"}
// and exited before the interval ever fired. The test still passed, because
// "flood" is not "proceed" and therefore refuses — the same reason bogus-choice
// passes. MAX_OUTPUT_BYTES went completely unexercised behind that false green.
const mode = process.argv[2];

if (mode === "flood") {
  setInterval(() => process.stdout.write("x".repeat(8192)), 1);
} else if (mode === "crash") {
  process.exit(3);
} else if (mode === "garbage") {
  process.stdout.write("not json at all");
  process.exit(0);
} else if (mode === "bogus-choice") {
  process.stdout.write(JSON.stringify({ choice: "maybe" }));
  process.exit(0);
} else if (mode === "hang") {
  setTimeout(() => {}, 60_000);
} else {
  process.stdout.write(JSON.stringify({ choice: mode }));
  process.exit(0);
}
