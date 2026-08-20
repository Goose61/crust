import { NextRequest, NextResponse } from "next/server";
import { getCollection, listCollections, saveCollection, slugify } from "@/lib/store";
import { generateCollection } from "@/lib/compositor";
import { publishCollection } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import type { Collection } from "@/lib/types";

export async function GET() {
  const collections = await listCollections();
  return NextResponse.json({ collections });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit(`collections:${ip}`, 30, 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await req.json()) as Partial<Collection> & { action?: string };
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const existing = await getCollection(body.id);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const merged: Collection = {
    ...existing,
    ...body,
    id: existing.id,
    payments: { ...existing.payments, ...body.payments, pizzaDiscountPercent: 0 },
    fees: { ...existing.fees, ...body.fees },
    milestones: body.milestones ?? existing.milestones,
    layers: body.layers ?? existing.layers,
    socials: { ...existing.socials, ...body.socials },
    traitPricing: body.traitPricing ?? existing.traitPricing,
    logoUrl: body.logoUrl ?? existing.logoUrl,
    royaltyBps: body.royaltyBps ?? existing.royaltyBps,
    royaltySplit: body.royaltySplit ?? existing.royaltySplit,
    tokens: existing.tokens,
  };
  if (body.name) merged.slug = slugify(body.name);

  if (body.action === "generate") {
    merged.tokens = await generateCollection({
      collectionId: merged.id,
      name: merged.name,
      description: merged.description,
      nameTemplate: merged.nameTemplate,
      supply: merged.supply,
      stackOrder: merged.stackOrder,
      layers: merged.layers,
      creatorWallet: merged.payments.creatorWallet,
      sellerFeeBps: 250,
      uniqueness: true,
    });
  }

  if (body.action === "publish") {
    const published = await publishCollection(merged);
    merged.tokens = published.tokens;
    merged.irysPublished = published.provider === "arweave";
    if (merged.blindMint) {
      merged.placeholderUri = `/api/assets/${merged.id}/placeholder`;
    }
  }

  if (body.action === "go-live") {
    if (!merged.fees.locked) merged.fees = { ...merged.fees, locked: true };
    merged.status = "live";
    merged.publicMintOpen = merged.allowlist.length === 0;
  }

  await saveCollection(merged);
  return NextResponse.json({ collection: merged });
}
