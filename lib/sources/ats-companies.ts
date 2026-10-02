export type AtsProvider = "greenhouse" | "lever" | "ashby";

export interface AtsCompany {
  name: string;
  provider: AtsProvider;
  token: string; // board slug used in the ATS API
}

/**
 * Seed list of remote-friendly / web3 companies on public ATS APIs.
 * Grow it over time, or drop a `seed-companies.json` array next to this file to
 * extend it. Unreachable tokens are skipped silently at fetch time.
 */
export const SEED_COMPANIES: AtsCompany[] = [
  // Greenhouse
  { name: "GitLab", provider: "greenhouse", token: "gitlab" },
  { name: "Stripe", provider: "greenhouse", token: "stripe" },
  { name: "Coinbase", provider: "greenhouse", token: "coinbase" },
  { name: "Anthropic", provider: "greenhouse", token: "anthropic" },
  { name: "Figma", provider: "greenhouse", token: "figma" },
  { name: "Databricks", provider: "greenhouse", token: "databricks" },
  { name: "Discord", provider: "greenhouse", token: "discord" },
  { name: "Dropbox", provider: "greenhouse", token: "dropbox" },
  { name: "Brex", provider: "greenhouse", token: "brex" },
  { name: "Consensys", provider: "greenhouse", token: "consensys" },
  // Lever
  { name: "Spotify", provider: "lever", token: "spotify" },
  // Ashby
  { name: "Ramp", provider: "ashby", token: "ramp" },
  { name: "Linear", provider: "ashby", token: "Linear" },
  { name: "Replit", provider: "ashby", token: "replit" },
  { name: "Vanta", provider: "ashby", token: "vanta" },
];
