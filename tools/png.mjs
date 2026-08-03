// Minimal PNG decoder with zero dependencies, built on node:zlib's
// inflateSync. It only ever reads captures produced by Electron's
// win.capturePage().toPNG() (and the hand-authored asset PNGs the render
// test compares against), so 8-bit non-interlaced RGBA is the only case
// this needs to handle — anything else throws a clear error rather than
// silently misreading pixels.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// PNG spec §9.2: each defiltered byte is reconstructed from the filtered
// byte plus a predictor built from already-reconstructed neighbours —
// a (left), b (above), c (upper-left). bpp is bytes-per-pixel (4 for 8-bit
// RGBA), used as the horizontal step between "left"/"upper-left" neighbours.
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(inflated, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filterType = inflated[src];
    src += 1;
    const rowStart = y * stride;
    const prevRowStart = rowStart - stride;
    for (let i = 0; i < stride; i++) {
      const filt = inflated[src + i];
      const a = i >= bpp ? out[rowStart + i - bpp] : 0;
      const b = y > 0 ? out[prevRowStart + i] : 0;
      const c = y > 0 && i >= bpp ? out[prevRowStart + i - bpp] : 0;
      let recon;
      switch (filterType) {
        case 0: recon = filt; break;                              // None
        case 1: recon = filt + a; break;                          // Sub
        case 2: recon = filt + b; break;                          // Up
        case 3: recon = filt + Math.floor((a + b) / 2); break;    // Average
        case 4: recon = filt + paethPredictor(a, b, c); break;    // Paeth
        default:
          throw new Error(`unsupported PNG scanline filter type ${filterType} at row ${y}`);
      }
      out[rowStart + i] = recon & 0xff;
    }
    src += stride;
  }
  return out;
}

export function decodePng(path) {
  const buf = readFileSync(path);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error(`${path} is not a PNG file (bad signature)`);
  }

  let offset = 8;
  let ihdr = null;
  const idatParts = [];
  let sawIend = false;

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) {
      throw new Error(`${path} is truncated inside chunk "${type}"`);
    }
    const data = buf.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data.readUInt8(8),
        colorType: data.readUInt8(9),
        compression: data.readUInt8(10),
        filter: data.readUInt8(11),
        interlace: data.readUInt8(12),
      };
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }

    offset = dataEnd + 4; // skip the trailing 4-byte CRC, untouched — these
                           // are self-produced captures, not hostile input.
  }

  if (!ihdr) throw new Error(`${path} has no IHDR chunk`);
  if (!sawIend) throw new Error(`${path} has no IEND chunk (truncated?)`);
  if (idatParts.length === 0) throw new Error(`${path} has no IDAT data`);

  const { width, height, bitDepth, colorType, interlace } = ihdr;
  if (bitDepth !== 8) {
    throw new Error(`${path}: only 8-bit PNGs are supported, got bit depth ${bitDepth}`);
  }
  if (colorType !== 6) {
    throw new Error(
      `${path}: only RGBA (color type 6) PNGs are supported, got color type ${colorType}`);
  }
  if (interlace !== 0) {
    throw new Error(`${path}: only non-interlaced PNGs are supported, got interlace method ${interlace}`);
  }

  const channels = 4;
  const inflated = inflateSync(Buffer.concat(idatParts));
  const expectedInflated = (width * channels + 1) * height;
  if (inflated.length < expectedInflated) {
    throw new Error(
      `${path}: decompressed data is ${inflated.length} bytes, expected at least ${expectedInflated}`);
  }

  const pixels = unfilter(inflated, width, height, channels);
  const stride = width * channels;

  const px = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      throw new Error(`${path}: pixel (${x},${y}) is outside the ${width}x${height} image`);
    }
    const i = y * stride + x * channels;
    return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
  };

  return { w: width, h: height, ch: channels, px };
}
