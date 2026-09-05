import { NextRequest, NextResponse } from "next/server";
import { getCollection, listCollections, saveCollection, slugify } from "@/lib/store";
import { generateCollection } from "@/lib/compositor";
import { publishCollection } from "@/lib/storage";
import { refreshCollectionMetadata } from "@/lib/metadata-refresh";
import { createMarketplaceCoreCollection } from "@/lib/create-core-collection";
import { getPlatformSecretKey } from "@/lib/platform-key";
import { explorerClusterQuery, getSolanaNetwork } from "@/lib/solana-config";
import { rateLimit } from "@/lib/rate-limit";
import { readAuthHeaders, assertCreatorAuth } from "@/lib/wallet-auth";
import { filterCollectionsForViewer, toPublicCollection } from "@/lib/public-collection";
import type { Collection } from "@/lib/types";

export async function GET(req: NextRequest) {
  const auth = readAuthHeaders(req);
  const collections = await listCollections();
  return NextResponse.json({
    collections: filterCollectionsForViewer(collections, auth?.wallet),
  });
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

  const auth = readAuthHeaders(req);

  try {
    assertCreatorAuth(auth, existing.payments.creatorWallet);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const {
    pendingMint: _pendingMint,
    pendingZipUrl: _pendingZipUrl,
    tokens: _tokens,
    ...safeBody
  } = body;
  void _pendingMint;
  void _pendingZipUrl;
  void _tokens;

  const merged: Collection = {
    ...existing,
    ...safeBody,
    id: existing.id,
    payments: {
      ...existing.payments,
      ...body.payments,
      pizzaDiscountPercent: 0,
      creatorWallet: existing.payments.creatorWallet,
    },
    fees: { ...existing.fees, ...body.fees },
    milestones: body.milestones ?? existing.milestones,
    layers: body.layers ?? existing.layers,
    socials: { ...existing.socials, ...body.socials },
    buybackTokenCa: body.buybackTokenCa ?? existing.buybackTokenCa,
    logoUrl: body.logoUrl ?? existing.logoUrl,
    royaltyBps: body.royaltyBps ?? existing.royaltyBps,
    royaltySplit: body.royaltySplit ?? existing.royaltySplit,
    launchDraft: body.launchDraft ?? existing.launchDraft,
    tokens: existing.tokens,
    pendingMint: existing.pendingMint,
    pendingZipUrl: existing.pendingZipUrl,
  };
  if (body.name) merged.slug = slugify(body.name);

  if (body.action === "generate") {
    try {
      merged.tokens = await generateCollection({
        collectionId: merged.id,
        name: merged.name,
        description: merged.description,
        nameTemplate: merged.nameTemplate,
        supply: merged.supply,
        stackOrder: merged.stackOrder,
        layers: merged.layers,
        creatorWallet: merged.payments.creatorWallet,
        sellerFeeBps: merged.royaltyBps ?? 500,
        royaltySplit: merged.royaltySplit,
        uniqueness: true,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (body.action === "publish") {
    const withMeta = await refreshCollectionMetadata(merged);
    merged.tokens = withMeta.tokens;
    const published = await publishCollection(merged);
    merged.tokens = published.tokens;
    merged.irysPublished = published.provider === "arweave";
    if (merged.blindMint) {
      merged.placeholderUri = `/api/assets/${merged.id}/placeholder`;
    }
  }

  if (body.action === "go-live") {
    if (!merged.fees.locked) merged.fees = { ...merged.fees, locked: true };
    merged.publicMintOpen = merged.allowlist.length === 0;

    const network = getSolanaNetwork();
    if (!merged.coreCollectionAddress && getPlatformSecretKey()) {
      try {
        const withMeta =
          merged.tokens.some((t) => t.metadataUri?.startsWith("http"))
            ? merged
            : await refreshCollectionMetadata(merged);
        merged.tokens = withMeta.tokens;
        const core = await createMarketplaceCoreCollection(merged, network);
        if (!core) {
          return NextResponse.json(
            { error: "On-chain collection was not created" },
            { status: 502 },
          );
        }
        merged.coreCollectionAddress = core.address;
        merged.coreCollectionTxUrl = `https://explorer.solana.com/tx/${core.txSignature}${explorerClusterQuery(network)}`;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Core collection creation failed";
        console.error("[go-live] Core collection creation failed:", e);
        return NextResponse.json(
          { error: `On-chain collection failed: ${message}` },
          { status: 502 },
        );
      }
    }
    merged.status = "live";
  }

  await saveCollection(merged);
  return NextResponse.json({ collection: toPublicCollection(merged) });
}
