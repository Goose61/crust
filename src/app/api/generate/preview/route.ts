import { NextRequest, NextResponse } from "next/server";
import { getCollection, saveCollection } from "@/lib/store";
import { generateCollection, readGeneratedImageBuffer } from "@/lib/compositor";
import { rateLimit } from "@/lib/rate-limit";
import { readAuthHeaders, assertCreatorAuth } from "@/lib/wallet-auth";
import { toPublicCollection } from "@/lib/public-collection";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit(`generate:${ip}`, 15, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json();
  const collection = await getCollection(body.id);
  if (!collection) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  try {
    assertCreatorAuth(readAuthHeaders(req), collection.payments.creatorWallet);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const previewCount = Math.min(Number(body.previewCount ?? 12), 24);
  const tokens = await generateCollection({
    collectionId: collection.id,
    name: body.name ?? collection.name,
    description: body.description ?? collection.description,
    nameTemplate: body.nameTemplate ?? collection.nameTemplate,
    supply: body.supply ?? collection.supply,
    stackOrder: body.stackOrder ?? collection.stackOrder,
    layers: body.layers ?? collection.layers,
    creatorWallet: body.creatorWallet ?? collection.payments.creatorWallet,
    sellerFeeBps: Math.round((body.royaltyPercent ?? 2.5) * 100),
    royaltySplit: collection.royaltySplit,
    previewCount,
    uniqueness: true,
  });

  collection.name = body.name ?? collection.name;
  collection.description = body.description ?? collection.description;
  collection.supply = body.supply ?? collection.supply;
  collection.stackOrder = body.stackOrder ?? collection.stackOrder;
  collection.layers = body.layers ?? collection.layers;
  collection.tokens = tokens;
  await saveCollection(collection);

  const previews = [];
  for (const token of tokens.slice(0, previewCount)) {
    // Prefer Blob URI; fall back to inline base64 from /tmp
    if (token.imageUri && !token.imageUri.startsWith("/api/")) {
      previews.push({
        tokenId: token.tokenId,
        dna: token.dna,
        attributes: token.attributes,
        image: token.imageUri,
      });
    } else {
      const buf = await readGeneratedImageBuffer(collection.id, token.tokenId);
      previews.push({
        tokenId: token.tokenId,
        dna: token.dna,
        attributes: token.attributes,
        image: buf ? `data:image/png;base64,${buf.toString("base64")}` : token.imageUri,
      });
    }
  }

  return NextResponse.json({ collection: toPublicCollection(collection), previews });
}
