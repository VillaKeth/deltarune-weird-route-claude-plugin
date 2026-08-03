const mode = process.argv[2];
if (mode === "flood") { setInterval(() => process.stdout.write("x".repeat(8192)), 1); }
if (mode === "crash") process.exit(3);
if (mode === "garbage") { process.stdout.write("not json at all"); process.exit(0); }
if (mode === "bogus-choice") { process.stdout.write(JSON.stringify({ choice: "maybe" })); process.exit(0); }
if (mode === "hang") { setTimeout(() => {}, 60_000); }
else { process.stdout.write(JSON.stringify({ choice: mode })); process.exit(0); }
