import { NextRequest, NextResponse } from "next/server";
import { newId, saveCollection, getCollection } from "@/lib/store";
import { buildImportingCollectionStub } from "@/lib/import-collection-stub";
import { seedCollectionFromSidecars } from "@/lib/metadata-review";
import { requireWalletAuth } from "@/lib/wallet-auth";
import { toPublicCollection } from "@/lib/public-collection";
import type { Collection, GeneratedToken, LayerCatalog } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportDraftBody = {
  id?: string;
  mode: "ready" | "layers";
  name?: string;
  description?: string;
  tokens?: GeneratedToken[];
  layers?: LayerCatalog[];
  stackOrder?: string[];
  sidecarJsonCount?: number;
  supply?: number;
};

export async function POST(req: NextRequest) {
  try {
    const auth = requireWalletAuth(req);
    const body = (await req.json()) as ImportDraftBody;

    if (body.mode !== "ready" && body.mode !== "layers") {
      return NextResponse.json({ error: "mode must be ready or layers" }, { status: 400 });
    }

    const name = String(body.name || "My collection").trim();
    const description = String(body.description || "").trim();
    const id =
      typeof body.id === "string" && body.id.trim().length > 0
        ? body.id.trim()
        : newId();

    const existing = await getCollection(id);
    if (existing) {
      if (existing.payments.creatorWallet !== auth.wallet) {
        return NextResponse.json({ error: "Collection id already in use" }, { status: 409 });
      }
    }

    let collection: Collection = {
      ...buildImportingCollectionStub({
        id,
        name,
        description,
        creatorWallet: auth.wallet,
      }),
      status: "draft",
      artPath: body.mode === "layers" ? "path-b" : "path-a",
      clientImport: true,
      pendingZipUrl: undefined,
      importProgress: undefined,
    };

    if (body.mode === "ready") {
      const tokens = (body.tokens ?? []).map((t) => ({
        ...t,
        imageUri: undefined,
        metadataUri: undefined,
      }));
      if (tokens.length === 0) {
        return NextResponse.json({ error: "tokens required for ready mode" }, { status: 400 });
      }
      collection = seedCollectionFromSidecars(
        collection,
        tokens,
        body.sidecarJsonCount ?? 0,
      );
      collection.supply = tokens.length;
    } else {
      collection.layers = body.layers ?? [];
      collection.stackOrder = body.stackOrder ?? [];
      collection.supply = body.supply ?? 0;
      collection.tokens = [];
    }

    await saveCollection(collection);
    return NextResponse.json({ collection: toPublicCollection(collection) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import draft failed";
    const status = message.includes("signature") || message.includes("Wallet") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
