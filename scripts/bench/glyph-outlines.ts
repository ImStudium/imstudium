/**
 * Glyph outlines from a TrueType font as SVG path data: just enough of the
 * format (cmap format 4, head, hhea, hmtx, loca, simple glyf glyphs) to draw
 * KaTeX's own italic letters as shapes instead of text. The benchmark uses it
 * for slides whose formulas are partly outlines, the way some PowerPoint PDFs
 * draw math italic letters as paths while digits and upright words stay text.
 */

export interface Outline {
  /** SVG path data in font units, y pointing down, baseline at 0. */
  d: string;
  advance: number;
}

export interface OutlineFont {
  unitsPerEm: number;
  ascent: number;
  /** Below the baseline, negative. */
  descent: number;
  glyph(ch: string): Outline;
}

export function loadOutlineFont(bytes: Uint8Array): OutlineFont {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < dv.getUint16(4); i++) {
    const o = 12 + 16 * i;
    tables.set(String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!), dv.getUint32(o + 8));
  }
  const at = (tag: string) => {
    const o = tables.get(tag);
    if (o === undefined) throw new Error(`font has no ${tag} table`);
    return o;
  };
  const head = at("head");
  const hhea = at("hhea");
  const unitsPerEm = dv.getUint16(head + 18);
  const longLoca = dv.getInt16(head + 50) === 1;
  const ascent = dv.getInt16(hhea + 4);
  const descent = dv.getInt16(hhea + 6);
  const numHMetrics = dv.getUint16(hhea + 34);
  const [hmtx, loca, glyf, cmap] = [at("hmtx"), at("loca"), at("glyf"), at("cmap")];

  let sub = -1;
  for (let i = 0; i < dv.getUint16(cmap + 2); i++) {
    const platform = dv.getUint16(cmap + 4 + 8 * i);
    const off = cmap + dv.getUint32(cmap + 8 + 8 * i);
    if ((platform === 3 || platform === 0) && dv.getUint16(off) === 4) {
      sub = off;
      break;
    }
  }
  if (sub < 0) throw new Error("font has no cmap format 4");
  const segX2 = dv.getUint16(sub + 6);
  const glyphId = (code: number): number => {
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      if (code > dv.getUint16(ends + 2 * i)) continue;
      const start = dv.getUint16(starts + 2 * i);
      if (code < start) return 0;
      const delta = dv.getInt16(deltas + 2 * i);
      const range = dv.getUint16(ranges + 2 * i);
      if (!range) return (code + delta) & 0xffff;
      const g = dv.getUint16(ranges + 2 * i + range + 2 * (code - start));
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  const offsetOf = (g: number) => (longLoca ? dv.getUint32(loca + 4 * g) : dv.getUint16(loca + 2 * g) * 2);

  const path = (g: number): string => {
    const start = glyf + offsetOf(g);
    if (offsetOf(g + 1) <= offsetOf(g)) return "";
    const contours = dv.getInt16(start);
    if (contours < 0) throw new Error(`glyph ${g} is composite`);
    const endPts = Array.from({ length: contours }, (_, i) => dv.getUint16(start + 10 + 2 * i));
    const n = endPts.length ? endPts[endPts.length - 1]! + 1 : 0;
    let p = start + 10 + 2 * contours;
    p += 2 + dv.getUint16(p);
    const flags: number[] = [];
    while (flags.length < n) {
      const f = bytes[p++]!;
      flags.push(f);
      if (f & 8) for (let r = bytes[p++]!; r > 0; r--) flags.push(f);
    }
    const coords = (short: number, same: number) => {
      const out: number[] = [];
      let v = 0;
      for (const f of flags) {
        if (f & short) v += f & same ? bytes[p++]! : -bytes[p++]!;
        else if (!(f & same)) {
          v += dv.getInt16(p);
          p += 2;
        }
        out.push(v);
      }
      return out;
    };
    const xs = coords(2, 16);
    const ys = coords(4, 32);
    let d = "";
    let first = 0;
    for (const last of endPts) {
      const pts = Array.from({ length: last - first + 1 }, (_, k) => ({ x: xs[first + k]!, y: -ys[first + k]!, on: (flags[first + k]! & 1) === 1 }));
      first = last + 1;
      if (!pts.length) continue;
      // Start on an on-curve point (or the midpoint of two off-curve ones).
      let s = pts.findIndex((q) => q.on);
      const ring = s < 0 ? [{ x: (pts[0]!.x + pts[1 % pts.length]!.x) / 2, y: (pts[0]!.y + pts[1 % pts.length]!.y) / 2, on: true }, ...pts] : [...pts.slice(s), ...pts.slice(0, s)];
      s = 0;
      d += `M${ring[0]!.x} ${ring[0]!.y}`;
      let ctrl: { x: number; y: number } | null = null;
      for (let k = 1; k <= ring.length; k++) {
        const q = ring[k % ring.length]!;
        if (q.on) {
          d += ctrl ? `Q${ctrl.x} ${ctrl.y} ${q.x} ${q.y}` : `L${q.x} ${q.y}`;
          ctrl = null;
        } else {
          if (ctrl) d += `Q${ctrl.x} ${ctrl.y} ${(ctrl.x + q.x) / 2} ${(ctrl.y + q.y) / 2}`;
          ctrl = q;
        }
      }
      d += "Z";
    }
    return d;
  };

  return {
    unitsPerEm,
    ascent,
    descent,
    glyph(ch: string): Outline {
      const g = glyphId(ch.codePointAt(0)!);
      if (!g) throw new Error(`font has no glyph for ${ch}`);
      return { d: path(g), advance: dv.getUint16(hmtx + 4 * Math.min(g, numHMetrics - 1)) };
    },
  };
}

/**
 * KaTeX HTML with its math italic letters (`mord mathnormal`) drawn as inline
 * SVG outlines of the same font at the same size and advance: the page looks
 * the same, but those letters are shapes in the PDF, not text.
 */
export function outlineMathItalic(html: string, font: OutlineFont): string {
  const em = (v: number) => `${(v / font.unitsPerEm).toFixed(4)}em`;
  return html.replace(/<span class="mord mathnormal"( style="[^"]*")?>([A-Za-z])<\/span>/g, (_m, style: string | undefined, ch: string) => {
    const g = font.glyph(ch);
    const h = font.ascent - font.descent;
    // Inline styles: KaTeX's stylesheet positions every svg absolutely at full width (its own stretchy glyphs).
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-font.ascent} ${g.advance} ${h}" style="display:inline-block;position:static;width:${em(g.advance)};height:${em(h)};vertical-align:${em(font.descent)};overflow:visible"><path d="${g.d}" fill="currentColor"/></svg>`;
    return `<span class="mord"${style ?? ""}>${svg}</span>`;
  });
}
