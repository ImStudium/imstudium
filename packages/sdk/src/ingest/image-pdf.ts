/**
 * Wrap one JPEG or PNG into a one-page PDF so pdf-inspector's on-device OCR can
 * read photos of whiteboards, scanned sheets and screenshots. Pure Node (zlib):
 * JPEG bytes pass through as DCTDecode; PNG is decoded (8-bit, non-interlaced;
 * alpha composited onto white) and re-deflated as raw gray or RGB.
 */
import { deflateSync, inflateSync } from "node:zlib";
import { buildPdf } from "./ocr-runtime.js";

/** Rendering resolution the page size assumes, so OCR sees the image at its own pixel size. */
export const IMAGE_PDF_DPI = 150;

interface RasterImage {
  width: number;
  height: number;
  colorSpace: "/DeviceGray" | "/DeviceRGB" | "/DeviceCMYK";
  filter: "/DCTDecode" | "/FlateDecode";
  data: Buffer;
  /** Adobe CMYK JPEGs are stored inverted. */
  invertCmyk?: boolean;
}

function jpegInfo(bytes: Buffer): RasterImage | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  let adobe = false;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    const len = bytes.readUInt16BE(i + 2);
    if (marker === 0xee) adobe = true;
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = bytes.readUInt16BE(i + 5);
      const width = bytes.readUInt16BE(i + 7);
      const comps = bytes[i + 9]!;
      const colorSpace = comps === 1 ? "/DeviceGray" : comps === 4 ? "/DeviceCMYK" : "/DeviceRGB";
      return { width, height, colorSpace, filter: "/DCTDecode", data: bytes, invertCmyk: comps === 4 && adobe };
    }
    i += 2 + len;
  }
  return null;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function pngInfo(bytes: Buffer): RasterImage | null {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!SIG.every((b, i) => bytes[i] === b)) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(pos);
    const type = bytes.toString("latin1", pos + 4, pos + 8);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!width || !height || depth !== 8 || interlace !== 0) return null; // keep it simple: 8-bit, non-interlaced
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
  if (!channels || (colorType === 3 && !palette)) return null;

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      const v = line[x]!;
      out[x] = (filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
    prev = out;
  }

  const gray = colorType === 0 || colorType === 4;
  const outChannels = gray ? 1 : 3;
  const dest = Buffer.alloc(width * height * outChannels);
  for (let p = 0; p < width * height; p++) {
    const s = p * channels;
    let rgb: [number, number, number];
    let alpha = 255;
    if (colorType === 3) {
      const idx = pixels[s]! * 3;
      rgb = [palette![idx] ?? 0, palette![idx + 1] ?? 0, palette![idx + 2] ?? 0];
    } else if (gray) {
      rgb = [pixels[s]!, pixels[s]!, pixels[s]!];
      if (colorType === 4) alpha = pixels[s + 1]!;
    } else {
      rgb = [pixels[s]!, pixels[s + 1]!, pixels[s + 2]!];
      if (colorType === 6) alpha = pixels[s + 3]!;
    }
    // Composite onto white: transparent screenshots read as black otherwise.
    const mix = (v: number) => Math.round((v * alpha + 255 * (255 - alpha)) / 255);
    if (gray) dest[p] = mix(rgb[0]);
    else {
      dest[p * 3] = mix(rgb[0]);
      dest[p * 3 + 1] = mix(rgb[1]);
      dest[p * 3 + 2] = mix(rgb[2]);
    }
  }
  return { width, height, colorSpace: gray ? "/DeviceGray" : "/DeviceRGB", filter: "/FlateDecode", data: deflateSync(dest) };
}

/** A one-page PDF showing the image at IMAGE_PDF_DPI, or null for formats we can't wrap (GIF, WebP, 16-bit PNG …). */
export function imageToPdf(bytes: Uint8Array, dpi = IMAGE_PDF_DPI): Buffer | null {
  return imagesToPdf([bytes], dpi);
}

/**
 * One PDF page per image (a scanned handout, a series of whiteboard photos),
 * each at `dpi`. Null when any image can't be wrapped.
 */
export function imagesToPdf(images: Uint8Array[], dpi = IMAGE_PDF_DPI): Buffer | null {
  const decoded: RasterImage[] = [];
  for (const bytes of images) {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const img = jpegInfo(buf) ?? pngInfo(buf);
    if (!img) return null;
    decoded.push(img);
  }
  if (!decoded.length) return null;
  // Objects: 1 catalog, 2 pages, then per page: page, content, image.
  const kids = decoded.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  const objects: Array<string | Buffer> = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${decoded.length} >>`];
  decoded.forEach((img, i) => {
    const page = 3 + i * 3;
    const w = (img.width * 72) / dpi;
    const h = (img.height * 72) / dpi;
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Im0 Do Q`;
    const decode = img.invertCmyk ? " /Decode [1 0 1 0 1 0 1 0]" : "";
    const imageHeader = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${img.colorSpace} /BitsPerComponent 8 /Filter ${img.filter}${decode} /Length ${img.data.length} >>\nstream\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      Buffer.concat([Buffer.from(imageHeader, "latin1"), img.data, Buffer.from("\nendstream", "latin1")]),
    );
  });
  return buildPdf(objects);
}
