import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/quotes";

export async function GET(req: NextRequest) {
  const usd = Number(req.nextUrl.searchParams.get("usd") ?? 25);
  const quote = await getQuote(usd);
  return NextResponse.json({ quote });
}
