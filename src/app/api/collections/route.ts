import { NextRequest, NextResponse } from "next/server";
import { getCollection, listCollections, saveCollection, slugify } from "@/lib/store";
import { getPlatformSecretKey } from "@/lib/platform-key";
import { explorerClusterQuery, getSolanaNetwork } from "@/lib/solana-config";
import { rateLimit } from "@/lib/rate-limit";
import { readAuthHeaders, assertCreatorAuth } from "@/lib/wallet-auth";
import { filterCollectionsForViewer, toPublicCollection } from "@/lib/public-collection";
import type { Collection } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const auth = readAuthHeaders(req);
    const collections = await listCollections();
    return NextResponse.json({
      collections: filterCollectionsForViewer(collections, auth?.wallet),
    });
  } catch (e) {
    console.error("[GET /api/collections]", e);
    const message = e instanceof Error ? e.message : "Could not list collections";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
    name: body.name !== undefined ? body.name : existing.name,
    description: body.description !== undefined ? body.description : existing.description,
    nameTemplate: body.nameTemplate !== undefined ? body.nameTemplate : existing.nameTemplate,
    symbol: body.symbol !== undefined ? body.symbol : existing.symbol,
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
    royaltyCreators: body.royaltyCreators ?? existing.royaltyCreators,
    sidecarJsonCount: body.sidecarJsonCount ?? existing.sidecarJsonCount,
    metadataConfirmed: body.metadataConfirmed ?? existing.metadataConfirmed,
    traitPricing: body.traitPricing ?? existing.traitPricing,
    revealTrigger: body.revealTrigger ?? existing.revealTrigger,
    revealAt: body.revealAt ?? existing.revealAt,
    revealAtPercent: body.revealAtPercent ?? existing.revealAtPercent,
    blindMint: body.blindMint ?? existing.blindMint,
    launchDraft: body.launchDraft ?? existing.launchDraft,
    tokens: Array.isArray(body.tokens) ? body.tokens : existing.tokens,
    pendingMint: existing.pendingMint,
    pendingZipUrl: existing.pendingZipUrl,
  };
  if (body.name) merged.slug = slugify(body.name);

  if (body.action === "generate") {
    if (merged.clientImport) {
      return NextResponse.json(
        { error: "Client-import collections generate in the browser at go-live" },
        { status: 400 },
      );
    }
    try {
      const { generateCollection } = await import("@/lib/compositor");
      merged.tokens = await generateCollection({
        collectionId: merged.id,
        name: merged.name,
        description: merged.description,
        nameTemplate: merged.nameTemplate,
        symbol: merged.symbol,
        supply: merged.supply,
        stackOrder: merged.stackOrder,
        layers: merged.layers,
        creatorWallet: merged.payments.creatorWallet,
        sellerFeeBps: merged.royaltyBps ?? 500,
        royaltySplit: merged.royaltySplit,
        royaltyCreators: merged.royaltyCreators,
        uniqueness: true,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (body.action === "publish") {
    if (merged.clientImport) {
      if (!merged.irysPublished || !merged.tokens.every((t) => t.metadataUri?.startsWith("http"))) {
        return NextResponse.json(
          { error: "Upload collection assets to Arweave from your wallet before go-live" },
          { status: 400 },
        );
      }
    } else {
      const { refreshCollectionMetadata } = await import("@/lib/metadata-refresh");
      const { publishCollection } = await import("@/lib/storage");
      const withMeta = await refreshCollectionMetadata(merged);
      merged.tokens = withMeta.tokens;
      const published = await publishCollection(merged);
      merged.tokens = published.tokens;
      merged.irysPublished = published.provider === "arweave";
      if (merged.blindMint) {
        merged.placeholderUri = `/api/assets/${merged.id}/placeholder`;
      }
    }
  }

  if (body.action === "go-live") {
    if (!merged.fees.locked) merged.fees = { ...merged.fees, locked: true };
    merged.publicMintOpen = merged.allowlist.length === 0;

    const network = getSolanaNetwork();
    if (!merged.coreCollectionAddress && getPlatformSecretKey()) {
      try {
        const { refreshCollectionMetadata } = await import("@/lib/metadata-refresh");
        const { createMarketplaceCoreCollection } = await import("@/lib/create-core-collection");
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
