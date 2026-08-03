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
  cornerColor: "rgb(170,255,230)",
  corners: Object.freeze([[6, 6], [290, 6], [6, 77], [290, 77]]),
});

export const innerRight = BOX.width - BOX.border;   // 290

export const rowY = (n) => BOX.textY + n * BOX.lineHeight;

export const MAX_CHARS = Object.freeze({
  withPortrait: Math.floor((innerRight - BOX.textX.withPortrait) / BOX.advance),
  noPortrait: Math.floor((innerRight - BOX.textX.noPortrait) / BOX.advance),
});

export const MAX_ROWS = 3;

export function wrapLines(text, { withPortrait = true } = {}) {
  const max = withPortrait ? MAX_CHARS.withPortrait : MAX_CHARS.noPortrait;
  const out = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur === "" ? word : `${cur} ${word}`;
    if (next.length > max) {
      out.push(cur);
      cur = `  ${word}`;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function assertFits(x, text, label) {
  const end = x + text.length * BOX.advance;
  if (end > innerRight) {
    throw new Error(`${label} ends at ${end}, inner right edge is ${innerRight}`);
  }
  return x;
}
