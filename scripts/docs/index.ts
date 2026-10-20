import { renderErrorsDoc } from "./errors.ts";

export interface GeneratedDoc {
  id: string;
  /** Relative to the repo root. */
  path: string;
  render: () => string | Promise<string>;
}

export const GENERATED_DOCS: GeneratedDoc[] = [{ id: "errors", path: "docs/ERRORS.md", render: renderErrorsDoc }];
