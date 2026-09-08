import { NextRequest, NextResponse } from "next/server";
import { getCollection, saveCollection } from "@/lib/store";
import { seedCollectionFromSidecars } from "@/lib/metadata-review";
import { assertCreatorAuth, requireWalletAuth } from "@/lib/wallet-auth";
import { toPublicCollection } from "@/lib/public-collection";
import type { GeneratedToken } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

type ImportTokensBody = {
  tokens?: GeneratedToken[];
  finalize?: boolean;
  sidecarJsonCount?: number;
};

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const auth = requireWalletAuth(req);
    const existing = await getCollection(id);
    if (!existing) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    assertCreatorAuth(auth, existing.payments.creatorWallet);

    const body = (await req.json()) as ImportTokensBody;
    const batch = (body.tokens ?? []).map((t) => ({
      ...t,
      imageUri: undefined,
      metadataUri: undefined,
    }));
    if (batch.length === 0 && !body.finalize) {
      return NextResponse.json({ error: "tokens batch required" }, { status: 400 });
    }

    const byId = new Map(existing.tokens.map((t) => [t.tokenId, t]));
    for (const token of batch) {
      byId.set(token.tokenId, token);
    }
    const mergedTokens = Array.from(byId.values()).sort((a, b) => a.tokenId - b.tokenId);

    let collection = {
      ...existing,
      tokens: mergedTokens,
      supply: mergedTokens.length,
    };

    if (body.finalize) {
      collection = seedCollectionFromSidecars(
        collection,
        mergedTokens,
        body.sidecarJsonCount ?? existing.sidecarJsonCount ?? 0,
      );
      collection.supply = mergedTokens.length;
    }

    await saveCollection(collection);
    return NextResponse.json({ collection: toPublicCollection(collection) });
  } catch (e) {
    console.error("[POST /api/collections/[id]/import-tokens]", e);
    const message = e instanceof Error ? e.message : "Import tokens failed";
    const status =
      message.includes("signature") || message.includes("creator") || message.includes("Wallet")
        ? 401
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
