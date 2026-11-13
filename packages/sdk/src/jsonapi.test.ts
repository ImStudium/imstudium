import { describe, expect, it } from "vitest";
import { htmlToText } from "./jsonapi.js";

describe("htmlToText", () => {
  it("keeps whitespace outside bold and italic markers, so markdown still reads them", () => {
    // As Stud.IP news send a date line (synthetic).
    expect(htmlToText("<p><strong>&nbsp;06.10.2026, 10:00 Uhr</strong></p>")).toBe("**06.10.2026, 10:00 Uhr**");
    expect(htmlToText("Termin:<strong> 06.10.2026 </strong>im Hörsaal")).toBe("Termin: **06.10.2026** im Hörsaal");
    expect(htmlToText("<b><span> Raum 2.13</span></b>")).toBe("**Raum 2.13**");
    expect(htmlToText("Bitte <em>vorher </em>anmelden")).toBe("Bitte _vorher_ anmelden");
  });

  it("drops markers around nothing, and never takes <blockquote> or <img> for <b> or <i>", () => {
    expect(htmlToText("A<strong> </strong>B")).toBe("A B");
    expect(htmlToText("<blockquote>Zitat</blockquote> und <b>fett</b>")).toBe("Zitat\n und **fett**");
    expect(htmlToText('<img alt="Plan"> und <i>kursiv</i>')).toBe("[Bild: Plan] und _kursiv_");
  });
});
