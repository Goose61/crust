import { NextRequest, NextResponse } from "next/server";
import { getCollection, updateCollection } from "@/lib/store";
import { fireDueMilestones } from "@/lib/milestones";
import { rateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const collection = await getCollection(id);
  if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ collection });
}

export async function POST(req: NextRequest, { params }: Params) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const { id } = await params;
  const body = await req.json();

  try {
    if (body.action === "waitlist") {
      // Rate limit waitlist joins per IP
      const rl = await rateLimit(`waitlist:${ip}`, 10, 60 * 60 * 1000);
      if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

      const collection = await updateCollection(id, (current) => {
        const wallet = String(body.wallet || "").trim();
        if (wallet && !current.waitlist.includes(wallet)) {
          current.waitlist.push(wallet);
        }
        return current;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ collection });
    }

    if (body.action === "allowlist") {
      const collection = await updateCollection(id, (current) => {
        const wallets = String(body.wallets || "")
          .split(/[\s,]+/)
          .map((w: string) => w.trim())
          .filter(Boolean);
        current.allowlist = Array.from(new Set([...current.allowlist, ...wallets]));
        return current;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ collection });
    }

    if (body.action === "mint") {
      // Rate limit mints per payer wallet
      const payer = String(body.payer || ip);
      const rl = await rateLimit(`mint:${payer}`, 10, 15 * 60 * 1000);
      if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

      let mintedTokenIds: number[] = [];
      const collection = await updateCollection(id, (current) => {
        if (current.status !== "live") throw new Error("Collection is not live");
        if (current.mintedCount >= current.supply) throw new Error("Sold out");

        const payerAddr = String(body.payer || "");
        if (
          !current.publicMintOpen &&
          current.allowlist.length > 0 &&
          !current.allowlist.includes(payerAddr)
        ) {
          throw new Error("Not on allowlist");
        }
        const qty = Math.max(1, Math.min(10, Number(body.qty ?? 1)));
        const remaining = current.supply - current.mintedCount;
        const minted = Math.min(qty, remaining);
        const recipient = String(body.recipient || body.payer || "");
        const requestedId = body.tokenId != null ? Number(body.tokenId) : null;
        const available = current.tokens.filter((t) => !t.owner);
        const pick =
          requestedId != null
            ? available.filter((t) => t.tokenId === requestedId).slice(0, 1)
            : available.slice(0, minted);
        if (pick.length === 0) {
          throw new Error(requestedId != null ? "That NFT is already sold" : "Sold out");
        }
        for (const token of pick) {
          token.owner = recipient;
        }
        mintedTokenIds = pick.map((t) => t.tokenId);
        current.mintedCount = current.tokens.filter((t) => t.owner).length;
        if (current.mintedCount >= current.supply) current.status = "sold_out";
        return fireDueMilestones(current);
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({
        collection,
        mintedTokenIds,
        recipient: body.recipient || body.payer,
      });
    }

    if (body.action === "reveal") {
      const collection = await updateCollection(id, (current) => {
        current.revealed = true;
        return current;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ collection });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    const status =
      message === "Not on allowlist" ? 403 : message === "not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
