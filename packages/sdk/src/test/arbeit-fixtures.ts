import type { FetchLike, FetchResponseLike } from "../arbeit/resolve.js";
import type { CslItem } from "../arbeit/types.js";

/**
 * Synthetic sources and service answers for the citation registry. Every
 * DOI uses Crossref's example prefix 10.5555, every person is invented, and
 * the ISBN is the well-known example 978-3-16-148410-0.
 */

export const BOOK: CslItem = {
  id: "mueller2021digitale",
  type: "book",
  title: "Digitale Lehre: Ein Handbuch",
  author: [{ family: "Müller", given: "Anna" }],
  issued: { "date-parts": [[2021]] },
  publisher: "Synthetik Verlag",
  "publisher-place": "Augsburg",
  edition: "2",
  ISBN: "9783161484100",
};

export const ARTICLE: CslItem = {
  id: "schmidt2020lernen",
  type: "article-journal",
  title: "Lernen im Netz",
  author: [
    { family: "Schmidt", given: "Bert" },
    { family: "Weber", given: "Clara" },
  ],
  issued: { "date-parts": [[2020, 3]] },
  "container-title": "Zeitschrift für Beispiele",
  volume: "12",
  issue: "3",
  page: "45-67",
  DOI: "10.5555/beispiel.2020.12",
};

export const DOI_CSL = {
  type: "article-journal",
  title: ["Lernen im <i>Netz</i>"],
  author: [
    { family: "Schmidt", given: "Bert", sequence: "first" },
    { family: "Weber", given: "Clara" },
  ],
  issued: { "date-parts": [[2020, 3]] },
  "container-title": "Zeitschrift für Beispiele",
  volume: "12",
  issue: "3",
  page: "45-67",
  DOI: "10.5555/BEISPIEL.2020.12",
  publisher: "Beispielverlag",
  reference: [{ key: "r1" }],
  "reference-count": 1,
};

export const CROSSREF_RETRACTED = {
  status: "ok",
  message: {
    DOI: "10.5555/zurueck.2019.1",
    type: "journal-article",
    "updated-by": [
      { updated: { "date-parts": [[2024, 5, 2]] }, DOI: "10.5555/zurueck.notice", type: "retraction", source: "retraction-watch", label: "Retraction" },
    ],
  },
};

export const DNB_SRU = `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/">
  <version>1.1</version>
  <numberOfRecords>1</numberOfRecords>
  <records><record><recordSchema>MARC21-xml</recordSchema><recordPacking>xml</recordPacking><recordData>
    <record xmlns="http://www.loc.gov/MARC21/slim" type="Bibliographic">
      <leader>00000nam a2200000 c 4500</leader>
      <datafield tag="020" ind1=" " ind2=" "><subfield code="a">9783161484100</subfield><subfield code="c">kart. : EUR 29.00</subfield></datafield>
      <datafield tag="041" ind1=" " ind2=" "><subfield code="a">ger</subfield></datafield>
      <datafield tag="100" ind1="1" ind2=" "><subfield code="a">Müller, Anna</subfield><subfield code="4">aut</subfield></datafield>
      <datafield tag="245" ind1="1" ind2="0"><subfield code="a">&#152;Die&#156; digitale Lehre</subfield><subfield code="b">ein Handbuch</subfield><subfield code="c">Anna Müller</subfield></datafield>
      <datafield tag="250" ind1=" " ind2=" "><subfield code="a">2. Auflage</subfield></datafield>
      <datafield tag="264" ind1=" " ind2="1"><subfield code="a">Augsburg</subfield><subfield code="b">Synthetik Verlag</subfield><subfield code="c">[2021]</subfield></datafield>
      <datafield tag="300" ind1=" " ind2=" "><subfield code="a">XII, 345 Seiten</subfield></datafield>
      <datafield tag="490" ind1="1" ind2=" "><subfield code="a">Beispielreihe</subfield><subfield code="v">Band 7</subfield></datafield>
      <datafield tag="700" ind1="1" ind2=" "><subfield code="a">Weber, Clara</subfield><subfield code="4">edt</subfield></datafield>
    </record>
  </recordData></record></records>
</searchRetrieveResponse>`;

export const PAGE_HTML = `<!doctype html><html><head>
<title>Ein Blogbeitrag | Beispielblog</title>
<meta property="og:title" content="Warum Quellen z&auml;hlen">
<meta property="og:site_name" content="Beispielblog">
<meta name="citation_author" content="Kaya, Deniz">
<meta name="article:published_time" content="2025-11-03T10:00:00Z">
</head><body>…</body></html>`;

function response(status: number, body: string, url = ""): FetchResponseLike {
  return { ok: status >= 200 && status < 300, status, url, headers: { get: () => null }, text: async () => body };
}

/** A fetch that answers from a table of URL prefixes; anything else is a 404. Records every URL. */
export function fakeFetch(routes: Record<string, [number, string] | Error>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const hit = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => url.startsWith(prefix));
    if (!hit) return response(404, "not found", url);
    const r = routes[hit]!;
    if (r instanceof Error) throw r;
    return response(r[0], r[1], url);
  }) as FetchLike & { calls: string[] };
  f.calls = calls;
  return f;
}
