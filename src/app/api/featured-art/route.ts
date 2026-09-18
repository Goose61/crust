import { NextResponse } from "next/server";
import { getCollection, listCollectionsForMarket } from "@/lib/store";
import { tokenImageSrc, tokenName } from "@/lib/collection-ui";
import { isGiftBundle } from "@/lib/gift-bundle";
import type { GeneratedToken } from "@/lib/types";

export const dynamic = "force-dynamic";

const DOUGH_BOI_SLUG = "dough-boi";
const SAMPLE_COUNT = 8;
const PREFERRED_IDS = [347, 236, 476, 535, 595, 345, 120, 173, 117, 282];

export type FeaturedArtItem = {
  tokenId: number;
  name: string;
  imageSrc: string;
  href: string;
};

export async function GET() {
  try {
    const collection =
      (await getCollection(DOUGH_BOI_SLUG)) ??
      (await listCollectionsForMarket()).find(
        (c) =>
          !isGiftBundle(c) &&
          (c.slug === DOUGH_BOI_SLUG || /^dough[\s-]?boi$/i.test(c.name)),
      ) ??
      null;

    if (!collection || (collection.status !== "live" && collection.status !== "sold_out")) {
      return NextResponse.json({ collectionHref: `/collection/${DOUGH_BOI_SLUG}`, tokens: [] });
    }

    const hrefBase = `/collection/${collection.slug || collection.id}`;
    const byId = new Map((collection.tokens ?? []).map((t) => [t.tokenId, t]));
    const picked: GeneratedToken[] = [];
    for (const id of PREFERRED_IDS) {
      const token = byId.get(id);
      if (token) picked.push(token);
      if (picked.length >= SAMPLE_COUNT) break;
    }
    if (picked.length < SAMPLE_COUNT) {
      const rest = (collection.tokens ?? []).filter((t) => !picked.some((p) => p.tokenId === t.tokenId));
      const step = Math.max(1, Math.floor(rest.length / Math.max(1, SAMPLE_COUNT - picked.length)));
      for (let i = 0; i < rest.length && picked.length < SAMPLE_COUNT; i += step) {
        picked.push(rest[i]);
      }
    }

    const tokens: FeaturedArtItem[] = picked.map((token) => ({
      tokenId: token.tokenId,
      name: tokenName(collection, token),
      imageSrc: tokenImageSrc(collection, token),
      href: `${hrefBase}?token=${token.tokenId}`,
    }));

    return NextResponse.json({
      collectionHref: hrefBase,
      tokens,
    });
  } catch (e) {
    console.error("[GET /api/featured-art]", e);
    return NextResponse.json({ collectionHref: `/collection/${DOUGH_BOI_SLUG}`, tokens: [] });
  }
}
