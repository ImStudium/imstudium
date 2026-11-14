import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { imageToPdf } from "./image-pdf.js";
import { encodePng } from "./png.js";

function chunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const out: Array<{ type: string; data: Buffer }> = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    out.push({ type: png.toString("ascii", o + 4, o + 8), data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}

describe("encodePng", () => {
  it("gray: header, unfiltered rows, and a PNG imageToPdf accepts", () => {
    const px = new Uint8Array([0, 128, 255, 10, 20, 30]);
    const png = encodePng(px, 3, 2, 1);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const c = chunks(png);
    expect(c.map((x) => x.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(c[0]!.data.readUInt32BE(0)).toBe(3);
    expect(c[0]!.data[9]).toBe(0);
    expect([...inflateSync(c[1]!.data)]).toEqual([0, 0, 128, 255, 0, 10, 20, 30]);
    expect(imageToPdf(png)).not.toBeNull();
  });

  it("RGBA, and a size mismatch is an error", () => {
    const png = encodePng(new Uint8Array(2 * 2 * 4).fill(200), 2, 2, 4);
    expect(chunks(png)[0]!.data[9]).toBe(6);
    expect(imageToPdf(png)).not.toBeNull();
    expect(() => encodePng(new Uint8Array(3), 2, 2, 1)).toThrow(/expected 4 bytes/);
  });
});
