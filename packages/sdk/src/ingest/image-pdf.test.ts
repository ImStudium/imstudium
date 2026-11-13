import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { IMAGE_PDF_DPI, imageToPdf } from "./image-pdf.js";

/**
 * Synthetic images only: tiny PNGs written here (every filter type, every
 * 8-bit colour type) and JPEG headers with just the markers imageToPdf reads.
 */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Encode raw 8-bit samples as PNG, row y filtered with filter type (y % 5) so every filter is exercised. */
function png(opts: { width: number; height: number; colorType: 0 | 2 | 3 | 4 | 6; samples: number[]; palette?: number[]; depth?: number; interlace?: number }): Buffer {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[opts.colorType];
  const stride = opts.width * channels;
  const raw: number[] = [];
  for (let y = 0; y < opts.height; y++) {
    const filter = y % 5;
    raw.push(filter);
    for (let x = 0; x < stride; x++) {
      const v = opts.samples[y * stride + x]!;
      const a = x >= channels ? opts.samples[y * stride + x - channels]! : 0;
      const b = y > 0 ? opts.samples[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? opts.samples[(y - 1) * stride + x - channels]! : 0;
      const pred = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
      raw.push((v - pred) & 0xff);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(opts.width, 0);
  ihdr.writeUInt32BE(opts.height, 4);
  ihdr[8] = opts.depth ?? 8;
  ihdr[9] = opts.colorType;
  ihdr[12] = opts.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...(opts.palette ? [chunk("PLTE", Buffer.from(opts.palette))] : []),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** SOI, optional APP14 "Adobe", SOF0 with the given size and components, EOI. Enough for the header reader. */
function jpeg(width: number, height: number, comps: 1 | 3 | 4, adobe = false): Buffer {
  const parts = [Buffer.from([0xff, 0xd8])];
  parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]));
  if (adobe) parts.push(Buffer.from([0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x02]));
  const sof = [0xff, 0xc0, 0x00, 8 + 3 * comps, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, comps];
  for (let i = 0; i < comps; i++) sof.push(i + 1, 0x11, 0x00);
  parts.push(Buffer.from(sof), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

/** The image XObject of a one-page PDF from imageToPdf: its dictionary and raw stream bytes. */
function imageObject(pdf: Buffer): { dict: string; data: Buffer; mediaBox: number[] } {
  const text = pdf.toString("latin1");
  const start = text.indexOf("/Subtype /Image");
  const dictStart = text.lastIndexOf("<<", start);
  const streamAt = text.indexOf(">>\nstream\n", start);
  const dict = text.slice(dictStart, streamAt + 2);
  const length = Number(/\/Length (\d+)/.exec(dict)![1]);
  const data = pdf.subarray(streamAt + ">>\nstream\n".length, streamAt + ">>\nstream\n".length + length);
  const mediaBox = /\/MediaBox \[([^\]]+)\]/.exec(text)![1]!.trim().split(/\s+/).map(Number);
  return { dict, data, mediaBox };
}

describe("imageToPdf: PNG", () => {
  it("gray: decodes every filter type back to the original samples", () => {
    const width = 7;
    const height = 10;
    const samples = Array.from({ length: width * height }, (_, i) => (i * 37 + 11) % 256);
    const pdf = imageToPdf(png({ width, height, colorType: 0, samples }))!;
    const img = imageObject(pdf);
    expect(img.dict).toContain("/ColorSpace /DeviceGray");
    expect(img.dict).toContain("/Filter /FlateDecode");
    expect(img.dict).toContain(`/Width ${width} /Height ${height}`);
    expect([...inflateSync(img.data)]).toEqual(samples);
  });

  it("RGB: keeps three channels", () => {
    const width = 5;
    const height = 6;
    const samples = Array.from({ length: width * height * 3 }, (_, i) => (i * 53 + 7) % 256);
    const img = imageObject(imageToPdf(png({ width, height, colorType: 2, samples }))!);
    expect(img.dict).toContain("/ColorSpace /DeviceRGB");
    expect([...inflateSync(img.data)]).toEqual(samples);
  });

  it("RGBA: composites onto white (transparent reads as white, opaque stays)", () => {
    // 3 pixels: opaque red, fully transparent black, half-transparent black
    const samples = [255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 128];
    const img = imageObject(imageToPdf(png({ width: 3, height: 1, colorType: 6, samples }))!);
    expect(img.dict).toContain("/ColorSpace /DeviceRGB");
    expect([...inflateSync(img.data)]).toEqual([255, 0, 0, 255, 255, 255, 127, 127, 127]);
  });

  it("gray + alpha: composites onto white as gray", () => {
    const samples = [0, 255, 0, 0, 200, 51];
    const img = imageObject(imageToPdf(png({ width: 3, height: 1, colorType: 4, samples }))!);
    expect(img.dict).toContain("/ColorSpace /DeviceGray");
    expect([...inflateSync(img.data)]).toEqual([0, 255, Math.round((200 * 51 + 255 * 204) / 255)]);
  });

  it("palette: expands indices to RGB", () => {
    const palette = [10, 20, 30, 200, 100, 0, 255, 255, 255];
    const samples = [0, 1, 2, 1, 0, 2];
    const img = imageObject(imageToPdf(png({ width: 3, height: 2, colorType: 3, samples, palette }))!);
    expect(img.dict).toContain("/ColorSpace /DeviceRGB");
    expect([...inflateSync(img.data)]).toEqual([10, 20, 30, 200, 100, 0, 255, 255, 255, 200, 100, 0, 10, 20, 30, 255, 255, 255]);
  });

  it("sizes the page so OCR sees the image at its own pixel size", () => {
    const pdf = imageToPdf(png({ width: 300, height: 150, colorType: 0, samples: new Array(300 * 150).fill(255) }))!;
    const { mediaBox } = imageObject(pdf);
    expect(mediaBox).toEqual([0, 0, (300 * 72) / IMAGE_PDF_DPI, (150 * 72) / IMAGE_PDF_DPI]);
  });

  it("writes a well-formed PDF with a correct xref table", () => {
    const pdf = imageToPdf(png({ width: 2, height: 2, colorType: 0, samples: [0, 1, 2, 3] }))!;
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it("refuses what it can't wrap: 16-bit, interlaced, missing palette", () => {
    expect(imageToPdf(png({ width: 1, height: 1, colorType: 0, samples: [0, 0], depth: 16 }))).toBeNull();
    expect(imageToPdf(png({ width: 1, height: 1, colorType: 0, samples: [0], interlace: 1 }))).toBeNull();
    expect(imageToPdf(png({ width: 1, height: 1, colorType: 3, samples: [0] }))).toBeNull();
  });
});

describe("imageToPdf: JPEG", () => {
  it.each([
    [1, "/DeviceGray"],
    [3, "/DeviceRGB"],
    [4, "/DeviceCMYK"],
  ] as const)("%i component(s) → %s, bytes passed through as DCTDecode", (comps, space) => {
    const bytes = jpeg(640, 480, comps);
    const img = imageObject(imageToPdf(bytes)!);
    expect(img.dict).toContain(`/ColorSpace ${space}`);
    expect(img.dict).toContain("/Filter /DCTDecode");
    expect(img.dict).toContain("/Width 640 /Height 480");
    expect(img.dict).not.toContain("/Decode");
    expect(Buffer.compare(img.data, bytes)).toBe(0);
  });

  it("Adobe CMYK JPEGs are inverted with /Decode", () => {
    const img = imageObject(imageToPdf(jpeg(10, 10, 4, true))!);
    expect(img.dict).toContain("/Decode [1 0 1 0 1 0 1 0]");
  });

  it("returns null for other formats", () => {
    expect(imageToPdf(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"))).toBeNull();
    expect(imageToPdf(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBeNull();
    expect(imageToPdf(Buffer.from([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
  });
});
