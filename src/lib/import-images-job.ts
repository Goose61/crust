import path from "path";
import { assignRarityRanks } from "@/lib/rarity";
import { uploadBlob, uploadBlobText } from "@/lib/blob-storage";
import { blobImagePath, blobMetadataPath } from "@/lib/paths";
import { buildTokenMetadataJson } from "@/lib/metadata-builders";
import {
  cleanupTempZipFile,
  downloadZipToTempFile,
  readZipImagesSequential,
  readZipTextEntry,
  scanZipArchive,
} from "@/lib/import-zip-server";
import { newId, saveCollection, updateCollection } from "@/lib/store";
import { type Collection, type GeneratedToken } from "@/lib/types";
import { buildImportingCollectionStub } from "@/lib/import-collection-stub";
import { deleteCollectionUploadZip } from "@/lib/blob-cleanup";

const DEFAULT_ROYALTY_BPS = 500;
const PROGRESS_EVERY = 5;

export type ImageImportParams = {
  collectionId: string;
  zipUrl: string;
  name: string;
  description: string;
  creatorWallet: string;
};

async function loadSidecarAttributes(
  zipPath: string,
  entryPath: string,
  tokenId: number,
  jsonPaths: Set<string>,
): Promise<GeneratedToken["attributes"]> {
  const jsonCandidates = [
    entryPath.replace(/\.(png|jpe?g|webp)$/i, ".json"),
    `metadata/${tokenId}.json`,
  ];
  for (const candidate of jsonCandidates) {
    if (!jsonPaths.has(candidate)) continue;
    try {
      const raw = await readZipTextEntry(zipPath, candidate);
      if (!raw) continue;
      const meta = JSON.parse(raw);
      return meta.attributes ?? [];
    } catch {
      // ignore malformed metadata
    }
  }
  return [];
}

export async function runImageImportJob(params: ImageImportParams): Promise<void> {
  const { collectionId, zipUrl, name, description, creatorWallet } = params;
  let tmpZip: string | null = null;

  try {
    tmpZip = await downloadZipToTempFile(zipUrl);
    const { images, jsonPaths } = await scanZipArchive(tmpZip);
    if (images.length === 0) {
      throw new Error("No images found in ZIP");
    }

    await updateCollection(collectionId, (current) => ({
      ...current,
      importProgress: { done: 0, total: images.length },
      supply: images.length,
    }));

    const tokens: GeneratedToken[] = [];

    await readZipImagesSequential(tmpZip, images, async (entryPath, buf, index) => {
      const tokenId = index + 1;
      const ext = path.extname(entryPath) || ".png";
      const safeExt = ext === ".jpg" ? ".jpeg" : ext;
      const imageUri = await uploadBlob(
        blobImagePath(collectionId, tokenId),
        buf,
        safeExt === ".png" ? "image/png" : safeExt === ".webp" ? "image/webp" : "image/jpeg",
      );
      const attributes = await loadSidecarAttributes(tmpZip!, entryPath, tokenId, jsonPaths);

      tokens.push({
        tokenId,
        dna: attributes.map((a) => String(a.value)).join("|"),
        attributes,
        imageRelPath: `images/${tokenId}${safeExt}`,
        metadataRelPath: `metadata/${tokenId}.json`,
        imageUri,
      });

      if (tokenId % PROGRESS_EVERY === 0 || tokenId === images.length) {
        await updateCollection(collectionId, (current) => ({
          ...current,
          importProgress: { done: tokenId, total: images.length },
        }));
      }
    });

    const ranked = assignRarityRanks(tokens);
    for (const token of ranked) {
      const metaJson = JSON.stringify(
        buildTokenMetadataJson({
          name: `${name} #${token.tokenId}`,
          symbol: name.slice(0, 8).toUpperCase(),
          description,
          sellerFeeBps: DEFAULT_ROYALTY_BPS,
          image: token.imageUri ?? token.imageRelPath,
          attributes: token.attributes,
          creatorWallet,
        }),
        null,
        2,
      );
      token.metadataUri = await uploadBlobText(blobMetadataPath(collectionId, token.tokenId), metaJson);
    }

    await updateCollection(collectionId, (current) => ({
      ...current,
      status: "draft",
      supply: ranked.length,
      tokens: ranked,
      pendingZipUrl: undefined,
      importProgress: undefined,
      updatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    console.error(`[import job ${collectionId}]`, err);
    await updateCollection(collectionId, (current) => ({
      ...current,
      status: "draft",
      pendingZipUrl: undefined,
      importProgress: {
        done: current.importProgress?.done ?? 0,
        total: current.importProgress?.total ?? 0,
        error: message,
      },
      tokens: [],
      supply: 0,
    }));
    throw err;
  } finally {
    if (tmpZip) await cleanupTempZipFile(tmpZip);
    await deleteCollectionUploadZip(zipUrl).catch((err) => {
      console.warn(`[import job ${collectionId}] could not delete source ZIP`, err);
    });
  }
}

/** Synchronous import for small direct uploads (no blob URL). */
export async function importImagesFromZipSync(
  form: FormData,
  creatorWallet: string,
): Promise<Collection> {
  const { loadZipFromImportForm } = await import("@/lib/import-zip-server");
  const name = String(form.get("name") || "Imported collection");
  const description = String(form.get("description") || "");
  const zip = await loadZipFromImportForm(form);
  const id = newId();

  const imageEntries = Object.entries(zip.files)
    .filter(([p, e]) => !e.dir && /\.(png|jpe?g|webp)$/i.test(p) && !p.includes("__MACOSX"))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  if (imageEntries.length === 0) {
    throw new Error("No images found in ZIP");
  }

  const tokens: GeneratedToken[] = [];
  let i = 1;
  for (const [entryPath, entry] of imageEntries) {
    const buf = Buffer.from(await entry.async("uint8array"));
    const ext = path.extname(entryPath) || ".png";
    const safeExt = ext === ".jpg" ? ".jpeg" : ext;
    const imageUri = await uploadBlob(
      blobImagePath(id, i),
      buf,
      safeExt === ".png" ? "image/png" : "image/jpeg",
    );

    const jsonName = entryPath.replace(/\.(png|jpe?g|webp)$/i, ".json");
    const jsonFile = zip.file(jsonName) ?? zip.file(`metadata/${i}.json`);
    let attributes: GeneratedToken["attributes"] = [];
    if (jsonFile) {
      try {
        const meta = JSON.parse(await jsonFile.async("string"));
        attributes = meta.attributes ?? [];
      } catch {
        attributes = [];
      }
    }
    tokens.push({
      tokenId: i,
      dna: attributes.map((a) => String(a.value)).join("|"),
      attributes,
      imageRelPath: `images/${i}${safeExt}`,
      metadataRelPath: `metadata/${i}.json`,
      imageUri,
    });
    i += 1;
  }

  const ranked = assignRarityRanks(tokens);
  for (const token of ranked) {
    const metaJson = JSON.stringify(
      buildTokenMetadataJson({
        name: `${name} #${token.tokenId}`,
        symbol: name.slice(0, 8).toUpperCase(),
        description,
        sellerFeeBps: DEFAULT_ROYALTY_BPS,
        image: token.imageUri ?? token.imageRelPath,
        attributes: token.attributes,
        creatorWallet,
      }),
      null,
      2,
    );
    token.metadataUri = await uploadBlobText(blobMetadataPath(id, token.tokenId), metaJson);
  }

  const collection: Collection = {
    ...buildImportingCollectionStub({ id, name, description, creatorWallet }),
    status: "draft",
    supply: ranked.length,
    tokens: ranked,
    importProgress: undefined,
  };
  await saveCollection(collection);
  return collection;
}
