import { describe, expect, it } from "vitest";
import { ocrSummaryLine } from "./ocr.js";

const ready = { ready: true, supported: true, disabled: false };
const none = { files: 0, pages: 0, lowConfidencePages: 0, imageOnlyPages: 0, recoveredPages: 0, formulas: 0, formulasChecked: 0, formulasNeedLook: 0, formulasUnchecked: 0 };

describe("the extract summary line", () => {
  it("says plainly how many formulas checked, need a look, or can't be checked", () => {
    expect(ocrSummaryLine({ ...none, formulas: 1059, formulasChecked: 619, formulasNeedLook: 58, formulasUnchecked: 382 }, ready)).toBe(
      "1059 formulas read as LaTeX: 619 checked against the PDF, 58 need a look, 382 can't be checked (scans and picture formulas)",
    );
    expect(ocrSummaryLine({ ...none, formulas: 2, formulasChecked: 1, formulasNeedLook: 1 }, ready)).toBe("2 formulas read as LaTeX: 1 checked against the PDF, 1 needs a look");
    expect(ocrSummaryLine({ ...none, formulas: 3, formulasChecked: 3 }, ready)).toBe("3 formulas read as LaTeX: 3 checked against the PDF");
    expect(ocrSummaryLine(none, ready)).toBe("");
  });
});
