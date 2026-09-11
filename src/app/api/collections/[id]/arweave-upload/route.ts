import { NextRequest, NextResponse } from "next/server";
import { assertCollectionArweaveStoragePaid } from "@/lib/arweave-storage-payment";
import { uploadToArweaveServer } from "@/lib/irys-server";
import { getCollection, updateCollection } from "@/lib/store";
import { assertCreatorAuth, requireWalletAuth } from "@/lib/wallet-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_ITEMS_PER_REQUEST = 8;

type UploadItem = {
  tokenId: number;
  imageBase64: string;
  contentType: string;
  metadataJson: string;
};

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const auth = requireWalletAuth(req);
    const collection = await getCollection(id);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    assertCreatorAuth(auth, collection.payments.creatorWallet);

    const body = (await req.json()) as {
      items?: UploadItem[];
      logo?: { dataBase64: string; contentType: string };
      paymentSignature?: string;
      minSol?: number;
    };

    const items = body.items ?? [];
    if (items.length === 0 && !body.logo) {
      return NextResponse.json({ error: "No upload items provided" }, { status: 400 });
    }
    if (items.length > MAX_ITEMS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Max ${MAX_ITEMS_PER_REQUEST} tokens per request` },
        { status: 413 },
      );
    }

    const minSol = Number(body.minSol ?? 0);
    if (!Number.isFinite(minSol) || minSol <= 0) {
      return NextResponse.json({ error: "minSol required" }, { status: 400 });
    }

    await assertCollectionArweaveStoragePaid({
      collectionId: id,
      paymentSignature: body.paymentSignature,
      minSol,
    });

    const uploaded: Record<number, { imageUri: string; metadataUri: string }> = {};
    for (const item of items) {
      const imageBuf = Buffer.from(item.imageBase64, "base64");
      const imageUri = await uploadToArweaveServer(imageBuf, item.contentType || "image/png");

      const meta = JSON.parse(item.metadataJson) as Record<string, unknown>;
      meta.image = imageUri;
      if (
        meta.properties &&
        typeof meta.properties === "object" &&
        Array.isArray((meta.properties as { files?: unknown[] }).files)
      ) {
        const files = (meta.properties as { files: { uri?: string }[] }).files;
        if (files[0]) files[0].uri = imageUri;
      }

      const metadataUri = await uploadToArweaveServer(
        Buffer.from(JSON.stringify(meta)),
        "application/json",
      );
      uploaded[item.tokenId] = { imageUri, metadataUri };
    }

    let logoUri: string | undefined;
    if (body.logo?.dataBase64) {
      logoUri = await uploadToArweaveServer(
        Buffer.from(body.logo.dataBase64, "base64"),
        body.logo.contentType || "image/png",
      );
    }

    if (Object.keys(uploaded).length > 0 || logoUri) {
      await updateCollection(id, (current) => {
        const tokens = current.tokens.map((token) => {
          const row = uploaded[token.tokenId];
          if (!row) return token;
          return { ...token, imageUri: row.imageUri, metadataUri: row.metadataUri };
        });
        return {
          ...current,
          tokens,
          ...(logoUri ? { logoUrl: logoUri } : {}),
          updatedAt: new Date().toISOString(),
        };
      });
    }

    return NextResponse.json({
      ok: true,
      tokens: uploaded,
      logoUri,
    });
  } catch (err) {
    console.error("[POST /api/collections/[id]/arweave-upload v2]", err);
    const message = err instanceof Error ? err.message : "Arweave upload failed";
    const status =
      message.includes("signature") ||
      message.includes("Unauthorized") ||
      message.includes("creator") ||
      message.includes("payment")
        ? 402
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
