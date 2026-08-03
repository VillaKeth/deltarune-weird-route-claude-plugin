// Deltarune text box geometry. Single source of truth — no other file may
// restate a pixel value. Numbers verified against the Deltarune border profile
// in xMirkix/yet-another-textbox-generator and by decoding the border asset.

export const BOX = Object.freeze({
  width: 297,
  height: 84,
  border: 7,
  slot: Object.freeze({ x: 7, y: 7, w: 67, h: 70 }),
  slotRight: Object.freeze({ x: 223, y: 7 }),
  fontSize: 16,
  lineHeight: 18,
  textY: 7,
  textX: Object.freeze({ withPortrait: 69, noPortrait: 11 }),
  asteriskOffset: -1,
  advance: 8,          // measured: Determination Mono Web is true monospace
  soul: 16,
  soulGap: 6,                    // space between the soul and the label it points at
  face: Object.freeze({ w: 56, h: 61 }),   // every assets/noelle/*.png, measured
  scale: 3,                      // on-screen magnification of the whole box
  cornerColor: "rgb(170,255,230)",
  corners: Object.freeze([[6, 6], [290, 6], [6, 77], [290, 77]]),
});

// Where each option label starts on the choice row. Lives here, not in the
// interaction module: these are pixel positions, and the spec requires every
// pixel value be declared exactly once.
export const OPTION_X = Object.freeze({ Proceed: 91, Refuse: 196 });

// The sprite is centred in its slot. Derived rather than written as 12,11 so a
// change to either the slot or the sprite size stays consistent.
export const faceOffset = Object.freeze({
  x: BOX.slot.x + Math.floor((BOX.slot.w - BOX.face.w) / 2),
  y: BOX.slot.y + Math.floor((BOX.slot.h - BOX.face.h) / 2),
});

export const innerRight = BOX.width - BOX.border;   // 290

export const rowY = (n) => BOX.textY + n * BOX.lineHeight;

export const MAX_CHARS = Object.freeze({
  withPortrait: Math.floor((innerRight - BOX.textX.withPortrait) / BOX.advance),
  noPortrait: Math.floor((innerRight - BOX.textX.noPortrait) / BOX.advance),
});

export const MAX_ROWS = 3;

export const INDENT = "  ";

// Continuation rows carry a two-space indent, so their usable width is two
// less than the first row's. Budgeting both rows identically is what let an
// over-long row escape: the indent was added after the fit check, not before.
// A token too long for an entire row is hard-broken rather than allowed to
// overflow — tool descriptions carry real filenames, which routinely exceed 27.
//
// `continuation` starts the wrap already past the first row, so every row it
// returns is indented. A paragraph that continues the one above it — the detail
// under "* it wants to run" — is a separate call to this function, and used to
// restart at first=true and hang back under the asterisk instead of aligning
// with her text.
export function wrapLines(text, { withPortrait = true, continuation = false } = {}) {
  const max = withPortrait ? MAX_CHARS.withPortrait : MAX_CHARS.noPortrait;
  const out = [];
  let cur = "";
  let first = !continuation;

  const budget = () => (first ? max : max - INDENT.length);
  const fits = (s) => s.length <= budget();
  const flush = () => {
    if (cur === "") return;                 // never emit an empty row
    out.push(first ? cur : INDENT + cur);
    first = false;
    cur = "";
  };

  for (const word of text.split(" ")) {
    if (word === "") continue;
    let rest = word;
    if (cur !== "" && !fits(`${cur} ${rest}`)) flush();
    while (!fits(rest)) {
      cur = rest.slice(0, budget());
      rest = rest.slice(budget());
      flush();
    }
    cur = cur === "" ? rest : `${cur} ${rest}`;
  }
  flush();
  return out;
}

export function assertFits(x, text, label) {
  const end = x + text.length * BOX.advance;
  if (end > innerRight) {
    throw new Error(`${label} ends at ${end}, inner right edge is ${innerRight}`);
  }
  return x;
}
