import { NextRequest, NextResponse } from "next/server";
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

    /** Creator-funded Irys balance — server signs bytes, creator pays via Irys approval. */
    const paidBy = auth.wallet;

    const uploaded: Record<number, { imageUri: string; metadataUri: string }> = {};
    for (const item of items) {
      const imageBuf = Buffer.from(item.imageBase64, "base64");
      const imageUri = await uploadToArweaveServer(imageBuf, item.contentType || "image/png", {
        skipFund: true,
        paidBy,
      });

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
        { skipFund: true, paidBy },
      );
      uploaded[item.tokenId] = { imageUri, metadataUri };
    }

    let logoUri: string | undefined;
    if (body.logo?.dataBase64) {
      logoUri = await uploadToArweaveServer(
        Buffer.from(body.logo.dataBase64, "base64"),
        body.logo.contentType || "image/png",
        { skipFund: true, paidBy },
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
    console.error("[POST /api/collections/[id]/arweave-upload v5]", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    const status =
      message.includes("Wallet signature required") ||
      message.includes("signature") ||
      message.includes("Unauthorized") ||
      message.includes("creator") ||
      message.includes("402") ||
      message.includes("underfunded")
        ? message.includes("Wallet signature required")
          ? 401
          : 402
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
