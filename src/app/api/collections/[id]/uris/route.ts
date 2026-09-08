import { NextRequest, NextResponse } from "next/server";
import { getCollection, saveCollection } from "@/lib/store";
import { assertCreatorAuth, requireWalletAuth } from "@/lib/wallet-auth";
import { toPublicCollection } from "@/lib/public-collection";
import type { GeneratedToken } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

type UriPatchBody = {
  tokens?: { tokenId: number; imageUri: string; metadataUri: string }[];
  logoUrl?: string;
  irysPublished?: boolean;
};

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const auth = requireWalletAuth(req);
    const existing = await getCollection(id);
    if (!existing) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    assertCreatorAuth(auth, existing.payments.creatorWallet);

    const body = (await req.json()) as UriPatchBody;
    const updates = new Map(
      (body.tokens ?? []).map((t) => [t.tokenId, t]),
    );

    const tokens: GeneratedToken[] = existing.tokens.map((token) => {
      const patch = updates.get(token.tokenId);
      if (!patch) return token;
      return {
        ...token,
        imageUri: patch.imageUri,
        metadataUri: patch.metadataUri,
      };
    });

    const merged = {
      ...existing,
      tokens,
      logoUrl: body.logoUrl ?? existing.logoUrl,
      irysPublished: body.irysPublished ?? true,
      updatedAt: new Date().toISOString(),
    };

    await saveCollection(merged);
    return NextResponse.json({ collection: toPublicCollection(merged) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "URI update failed";
    const status =
      message.includes("signature") || message.includes("creator") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
