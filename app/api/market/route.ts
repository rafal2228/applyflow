import { marketCounts, snapshotMarket } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(marketCounts());
}

export async function POST() {
  return Response.json(snapshotMarket());
}
