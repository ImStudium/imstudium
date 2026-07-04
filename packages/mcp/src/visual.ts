import { buildAgentVisualPayload, buildSlideViewer } from "imstudium-sdk";
import type { AgentVisualPayload } from "imstudium-sdk";

export async function materialVisualPayload(
  outDir: string,
  title: string,
): Promise<AgentVisualPayload & { pageImages: string[]; viewerHtml?: string }> {
  const { viewerHtml, pageImages } = await buildSlideViewer(outDir, title);
  const visual = buildAgentVisualPayload(pageImages, pageImages.length > 0 ? viewerHtml : undefined);
  return { ...visual, pageImages, viewerHtml: pageImages.length > 0 ? viewerHtml : undefined };
}
