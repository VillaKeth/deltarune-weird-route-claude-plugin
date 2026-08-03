// Console bytes to the key names src/nav.mjs speaks.
//
// Pure, and in src/ rather than in the renderer, for the same reason nav.mjs
// is: a module that starts a scene when imported cannot be unit tested, and
// key decoding is exactly the kind of parsing that wants a table of cases.
export function decodeKeys(text) {
  const keys = [];
  let rest = typeof text === "string" ? text : "";

  while (rest.length > 0) {
    if (rest.startsWith("\x1b[")) {
      const arrow = /^\x1b\[([A-D])/.exec(rest);
      if (arrow) {
        keys.push({ A: "ArrowUp", B: "ArrowDown", C: "ArrowRight", D: "ArrowLeft" }[arrow[1]]);
        rest = rest.slice(3);
        continue;
      }
      // Some other CSI: a cursor-position report, a mouse event, a bracketed
      // paste marker. Dropped whole. Letting its bytes fall through would read
      // the "R" of a size report as a keypress.
      const end = rest.slice(2).search(/[A-Za-z~]/);
      if (end === -1) break;              // incomplete; wait for the rest
      rest = rest.slice(2 + end + 1);
      continue;
    }

    const ch = rest[0];
    rest = rest.slice(1);
    if (ch === "\x1b") { keys.push("Escape"); continue; }
    if (ch === "\r" || ch === "\n") { keys.push("Enter"); continue; }
    // Ctrl-C is the terminal's universal "stop", and stopping is a refusal.
    if (ch === "\x03") { keys.push("Escape"); continue; }
    keys.push(ch);
  }
  return keys;
}
