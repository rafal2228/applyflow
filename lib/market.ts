import { countMatching, saveSnapshot, snapshotTrend } from "./db";
import { todayStr } from "./util";

/** Default market keywords (override via MONITOR_KEYWORDS). */
const envKeywords =
  process.env.MONITOR_KEYWORDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

export const MONITOR_KEYWORDS: string[] = envKeywords.length
  ? envKeywords
  : [
      "react",
      "typescript",
      "next.js",
      "node",
      "kubernetes",
      "web3",
      "solidity",
      "engineering manager",
    ];

export interface MarketRow {
  keyword: string;
  pl: number;
  remoteGlobal: number;
}

/** Live matching-posting counts by keyword (PL vs global remote). */
export function marketCounts(): { day: string; counts: MarketRow[] } {
  const day = todayStr();
  const counts = MONITOR_KEYWORDS.map((keyword) => ({
    keyword,
    pl: countMatching(keyword, "PL"),
    remoteGlobal: countMatching(keyword, "remote-global"),
  }));
  return { day, counts };
}

/** Live counts + persist today's snapshot (so digest trends keep working). */
export function snapshotMarket(): { day: string; counts: MarketRow[] } {
  const { day, counts } = marketCounts();
  for (const c of counts) {
    saveSnapshot(day, c.keyword, "PL", c.pl);
    saveSnapshot(day, c.keyword, "remote-global", c.remoteGlobal);
  }
  return { day, counts };
}

export function trend(keyword: string): { pl: number | null; remoteGlobal: number | null } {
  const pl = snapshotTrend(keyword, "PL");
  const rg = snapshotTrend(keyword, "remote-global");
  const latest = (rows: { day: string; count: number }[]) =>
    rows.length ? rows[0].count : null;
  return { pl: latest(pl), remoteGlobal: latest(rg) };
}
