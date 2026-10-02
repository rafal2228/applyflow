import type { Source } from "./source";
import { mkJob } from "./source";
import { fetchJson, htmlToText } from "../util";
import { config } from "../config";

interface AlgoliaHit {
  objectID: string;
  title?: string;
}
interface HnItem {
  id: number;
  children?: HnItem[];
  text?: string;
  author?: string;
}

const KEYWORDS = [...config.titleKeywords, ...config.stackKeywords];

/**
 * Hacker News "Who is Hiring?" — parse the latest monthly thread's top-level
 * comments. Only keeps comments mentioning "remote" + a relevant keyword.
 */
export const hackernews: Source = {
  name: "hackernews",
  async fetch() {
    const search = await fetchJson<{ hits: AlgoliaHit[] }>(
      "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who%20is%20hiring&hitsPerPage=4",
    );
    const story = (search.hits ?? []).find((h) =>
      (h.title ?? "").toLowerCase().includes("who is hiring"),
    );
    if (!story) return [];

    const item = await fetchJson<HnItem>(
      `https://hn.algolia.com/api/v1/items/${story.objectID}`,
    );
    const out = [];
    for (const c of item.children ?? []) {
      if (!c.text) continue;
      const text = htmlToText(c.text);
      const lc = text.toLowerCase();
      if (!lc.includes("remote")) continue;
      if (!KEYWORDS.some((k) => lc.includes(k))) continue;

      const firstLine = text.split("\n")[0].trim();
      const seg = firstLine.split("|").map((s) => s.trim());
      const company = seg[0] || "Unknown";
      const title =
        seg
          .slice(1)
          .find((s) => /engineer|developer|lead|manager|staff|principal/i.test(s)) ||
        firstLine;
      out.push(
        mkJob("hackernews", {
          sourceId: String(c.id),
          url: `https://news.ycombinator.com/item?id=${c.id}`,
          title: title.slice(0, 140),
          company: company.slice(0, 80),
          location: "Remote",
          remote: true,
          geo: "global",
          description: text,
          raw: { author: c.author },
        }),
      );
    }
    return out;
  },
};
