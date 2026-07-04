import { readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

/** List rendered page image paths in an extracted dir (sorted). */
export async function listPageImages(outDir: string): Promise<string[]> {
  try {
    const pagesDir = join(outDir, "pages");
    const files = await readdir(pagesDir);
    return files
      .filter((f) => IMAGE_RE.test(f))
      .sort()
      .map((f) => join(pagesDir, f));
  } catch {
    return [];
  }
}

/**
 * Write a static slide viewer (no server). Fast — reads pages/ only.
 * Playwright / browser MCP: open `file://${viewerHtml}`.
 */
export async function buildSlideViewer(
  outDir: string,
  title?: string,
): Promise<{ viewerHtml: string; pageImages: string[] }> {
  const pageImages = await listPageImages(outDir);
  if (pageImages.length === 0) {
    return { viewerHtml: join(outDir, "viewer.html"), pageImages: [] };
  }
  const viewerHtml = join(outDir, "viewer.html");
  const label = title || basename(outDir);

  const slides = pageImages.map((abs, i) => {
    const rel = `pages/${basename(abs)}`;
    return `<section class="slide" id="slide-${i + 1}"><h2>Page ${i + 1}</h2><img src="${rel}" alt="Page ${i + 1}" loading="lazy"/></section>`;
  });

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(label)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:1rem;background:#111;color:#eee}
  h1{font-size:1.25rem;margin-bottom:1rem}
  .slide{margin:2rem 0;padding:1rem;border:1px solid #333;border-radius:8px;background:#1a1a1a}
  .slide h2{font-size:.9rem;color:#888;margin:0 0 .75rem}
  img{max-width:100%;height:auto;display:block;border-radius:4px}
  .hint{font-size:.85rem;color:#aaa;margin-bottom:1.5rem}
</style>
</head>
<body>
<h1>${escapeHtml(label)}</h1>
<p class="hint">Agent: read each image below, or automate with Playwright on this file URL. Text in content.md is incomplete for diagrams and formulas.</p>
${slides.join("\n")}
</body>
</html>`;

  await writeFile(viewerHtml, html);
  return { viewerHtml, pageImages };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface AgentVisualPayload {
  /** REQUIRED before answering about slide/diagram content */
  requiredAction: string;
  pageImages: string[];
  viewerHtml?: string;
  viewerFileUrl?: string;
  methods: Array<{
    id: "read_image" | "playwright" | "browser_mcp";
    priority: number;
    when: string;
    action: string;
  }>;
}

/** Structured instructions every agent harness should follow for slides. */
export function buildAgentVisualPayload(
  pageImages: string[],
  viewerHtml?: string,
): AgentVisualPayload {
  const viewerFileUrl = viewerHtml ? `file://${viewerHtml}` : undefined;
  const methods: AgentVisualPayload["methods"] = [];

  if (pageImages.length > 0) {
    methods.push({
      id: "read_image",
      priority: 1,
      when: "You can read local image files (Read tool, multimodal attachment, vision)",
      action: `Open EVERY path in pageImages before summarizing. Text-only answers about slides are wrong if you skip images: ${pageImages.slice(0, 3).join(", ")}${pageImages.length > 3 ? ` (+${pageImages.length - 3} more)` : ""}`,
    });
  }

  if (viewerFileUrl && pageImages.length > 0) {
    methods.push({
      id: "playwright",
      priority: 2,
      when: "You have Playwright CLI or browser automation",
      action: `Navigate to viewerFileUrl and screenshot each .slide img, OR: npx playwright-cli open "${viewerFileUrl}"`,
    });
    methods.push({
      id: "browser_mcp",
      priority: 3,
      when: "You have cursor-ide-browser / CDP MCP",
      action: `browser_navigate to viewerFileUrl, then browser_take_screenshot per slide section`,
    });
  }

  return {
    requiredAction:
      pageImages.length > 0
        ? "MANDATORY: Visually inspect all pageImages (or viewerHtml via Playwright/browser) BEFORE explaining slide content, diagrams, formulas, or layout. Extracted text is supplementary only."
        : "No page images available — run imstudium doctor (poppler) or imstudium extract, then retry.",
    pageImages,
    viewerHtml,
    viewerFileUrl,
    methods,
  };
}
