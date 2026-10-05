import { createHash } from "node:crypto";

/**
 * Near-duplicate fingerprinting for job postings.
 *
 * The same role is routinely cross-posted to several boards with slightly
 * different titles ("Senior Frontend Engineer" vs "Sr. Frontend Engineer (React)")
 * and company spellings. The exact `dedupKey` in lib/util.ts only catches
 * byte-identical normalised company+title pairs, so we add a fuzzy layer:
 *
 *  1. A **MinHash signature** over title/company/location/tag shingles gives an
 *     estimate of the Jaccard similarity between two postings.
 *  2. The signature is split into **LSH bands**. Two postings that share a band
 *     are *candidates* — this is the "bloom filter" narrowing step: we never
 *     compare the whole table, only postings that collide on a band.
 *  3. A **SimHash mask** gives a cheap 64-bit locality fingerprint (Hamming
 *     distance) used as a secondary signal.
 *
 * Everything here is deterministic (fixed hash seeds) so signatures computed in
 * different processes / runs stay comparable.
 */

/** Words per shingle when building the token set. */
const SHINGLE = 3;
/** Length of the MinHash signature (number of permutations). */
export const SIGNATURE_SIZE = 64;
/** Rows per LSH band. `SIGNATURE_SIZE / BAND_ROWS` bands are produced. */
export const BAND_ROWS = 4;
/** Largest 32-bit prime, used for universal hashing. */
const PRIME = 4294967291;

export interface FingerprintSource {
  title: string;
  company: string;
  location?: string | null;
  tags?: string[];
  description?: string;
}

export interface Fingerprint {
  /** MinHash signature, `SIGNATURE_SIZE` unsigned 32-bit ints. */
  signature: number[];
  /** LSH band keys — candidates share at least one. */
  bands: string[];
  /** 64-bit SimHash as 16 hex chars. */
  mask: string;
  /** Normalised token count (0 when there is nothing to compare). */
  tokens: number;
}

export function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(s: string | null | undefined): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

/** FNV-1a 32-bit hash with an optional seed (for independent permutations). */
function fnv1a(str: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 64-bit FNV-1a as a bigint (used for the SimHash mask). */
function fnv1a64(str: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

/** Per-token MinHash signature of a shingle set. */
function minhash(shingles: Set<string>): number[] {
  const sig = new Array<number>(SIGNATURE_SIZE).fill(0xffffffff);
  for (const shingle of shingles) {
    const a = fnv1a(shingle, 0);
    const b = fnv1a(shingle, 0x9e3779b9);
    for (let i = 0; i < SIGNATURE_SIZE; i++) {
      const h = (a + Math.imul(i, b) + Math.imul(i, i)) % PRIME;
      if (h < sig[i]) sig[i] = h;
    }
  }
  return sig;
}

function bandsOf(signature: number[]): string[] {
  const bands: string[] = [];
  for (let b = 0; b < signature.length; b += BAND_ROWS) {
    const chunk = signature.slice(b, b + BAND_ROWS).join(",");
    bands.push(createHash("sha1").update(chunk).digest("hex").slice(0, 16));
  }
  return bands;
}

/**
 * Weighted 64-bit SimHash over the role-defining fields. Location and
 * description are deliberately excluded: they are full of generic boilerplate
 * ("remote", "about us", legal blurbs) that makes unrelated roles look similar.
 */
function simhash(source: FingerprintSource): string {
  const weighted: [string, number][] = [
    ...words(source.title).map((w): [string, number] => [w, 6]),
    ...words(source.company).map((w): [string, number] => [w, 4]),
    ...(source.tags ?? []).flatMap((t) =>
      words(t).map((w): [string, number] => [w, 3]),
    ),
  ];

  const bits = new Array<number>(64).fill(0);
  for (const [token, weight] of weighted) {
    const h = fnv1a64(token);
    for (let i = 0; i < 64; i++) {
      const bit = (h >> BigInt(i)) & 1n;
      bits[i] += bit === 1n ? weight : -weight;
    }
  }
  let mask = 0n;
  for (let i = 0; i < 64; i++) if (bits[i] >= 0) mask |= 1n << BigInt(i);
  return mask.toString(16).padStart(16, "0");
}

/** Build the shingle set used for MinHash / Jaccard. */
function shingles(source: FingerprintSource): Set<string> {
  const out = new Set<string>();

  const title = words(source.title);
  for (const w of title) out.add(`t:${w}`);
  for (let i = 0; i + SHINGLE <= title.length; i++)
    out.add(`t:${title.slice(i, i + SHINGLE).join(" ")}`);

  const company = words(source.company);
  for (const w of company) out.add(`c:${w}`);

  for (const tag of source.tags ?? [])
    for (const w of words(tag)) out.add(`g:${w}`);

  return out;
}

export function fingerprintJob(source: FingerprintSource): Fingerprint {
  const set = shingles(source);
  const signature = minhash(set);
  return {
    signature,
    bands: bandsOf(signature),
    mask: simhash(source),
    tokens: set.size,
  };
}

/** Estimated Jaccard similarity (0–1) from two MinHash signatures. */
export function estimatedJaccard(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let same = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  return same / n;
}

/** Hamming similarity (0–1) of two 16-hex SimHash masks. */
export function maskSimilarity(a: string, b: string): number {
  try {
    let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let ones = 0;
    while (x) {
      ones += Number(x & 1n);
      x >>= 1n;
    }
    return 1 - ones / 64;
  } catch {
    return 0;
  }
}

/**
 * Token overlap of two company names ("Acme Inc" vs "Acme" ≈ 0.5, "Acme" vs
 * "Globex" = 0). Used as a gate so same-title roles at different companies are
 * not queued as duplicates. Unknown/blank names pass (0.5) rather than block.
 */
export function companySimilarity(a: string, b: string): number {
  const sa = new Set(words(a));
  const sb = new Set(words(b));
  if (!sa.size || !sb.size) return 0.5;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Combined similarity: MinHash Jaccard weighted with the SimHash signal. */
export function similarity(
  a: Pick<Fingerprint, "signature" | "mask">,
  b: Pick<Fingerprint, "signature" | "mask">,
): number {
  const j = estimatedJaccard(a.signature, b.signature);
  const m = maskSimilarity(a.mask, b.mask);
  return 0.65 * j + 0.35 * m;
}
