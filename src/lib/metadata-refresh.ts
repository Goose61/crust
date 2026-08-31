import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Collection } from "./types";
import { buildTokenMetadataJson } from "./metadata-builders";
import { uploadBlobText } from "./blob-storage";
import { blobMetadataPath, tmpMetadataDir } from "./paths";
import { tokenName } from "./collection-ui";

/** Rebuild off-chain metadata JSON for every token (royalties, creators, names). */
export async function refreshCollectionMetadata(collection: Collection): Promise<Collection> {
  const bps = collection.royaltyBps ?? 500;
  const metaDir = tmpMetadataDir(collection.id);
  await mkdir(metaDir, { recursive: true });
  const tokens = collection.tokens.map((token) => ({ ...token }));

  for (const token of tokens) {
    const name = tokenName(collection, token);
    const image = token.imageUri ?? token.imageRelPath;
    const metadata = buildTokenMetadataJson({
      name,
      symbol: collection.symbol || collection.name.slice(0, 8).toUpperCase(),
      description: collection.description,
      sellerFeeBps: bps,
      image,
      attributes: token.attributes,
      creatorWallet: collection.payments.creatorWallet,
      royaltySplit: collection.royaltySplit,
    });
    const metaJson = JSON.stringify(metadata, null, 2);
    const localMetaPath = path.join(metaDir, `${token.tokenId}.json`);
    await writeFile(localMetaPath, metaJson);
    token.metadataUri = await uploadBlobText(
      blobMetadataPath(collection.id, token.tokenId),
      metaJson,
    );
  }

  return { ...collection, tokens };
}

/** Load metadata from local tmp or existing URI for publish fallback. */
export async function readTokenMetadataRecord(
  collectionId: string,
  tokenId: number,
): Promise<Record<string, unknown> | null> {
  const localMeta = path.join(tmpMetadataDir(collectionId), `${tokenId}.json`);
  if (existsSync(localMeta)) {
    return JSON.parse(await readFile(localMeta, "utf8")) as Record<string, unknown>;
  }
  return null;
}
