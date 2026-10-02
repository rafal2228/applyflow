import type { Source } from "./source";
import { mkJob } from "./source";
import { fetchText } from "../util";

const FEEDS = [
  "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss",
];

function tag(block: string, name: string): string {
  const m = block.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"),
  );
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

/** We Work Remotely — per-category RSS feeds (no key needed). */
export const weworkremotely: Source = {
  name: "weworkremotely",
  async fetch() {
    const out = [];
    for (const feed of FEEDS) {
      let xml: string;
      try {
        xml = await fetchText(feed);
      } catch {
        continue;
      }
      const items = xml.split(/<item>/).slice(1);
      for (const it of items) {
        const block = it.split("</item>")[0];
        const link = tag(block, "link");
        const rawTitle = tag(block, "title"); // "Company: Title"
        const region = tag(block, "region");
        if (!link || !rawTitle) continue;
        const [companyPart, ...titleParts] = rawTitle.split(":");
        const title = (titleParts.join(":") || companyPart).trim();
        const company = titleParts.length ? companyPart.trim() : "Unknown";
        out.push(
          mkJob("weworkremotely", {
            sourceId: link,
            url: link,
            title,
            company,
            location: region || "Remote",
            remote: true,
            geo: "global",
            descriptionHtml: tag(block, "description"),
            postedAt: tag(block, "pubDate") || null,
            raw: { rawTitle, region },
          }),
        );
      }
    }
    return out;
  },
};
