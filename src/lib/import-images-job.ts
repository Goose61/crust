import path from "path";
import { assignRarityRanks } from "@/lib/rarity";
import { uploadBlob } from "@/lib/blob-storage";
import { blobImagePath } from "@/lib/paths";
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
import { parseSidecarJson, seedCollectionFromSidecars } from "@/lib/metadata-review";

const PROGRESS_EVERY = 5;

export type ImageImportParams = {
  collectionId: string;
  zipUrl: string;
  name: string;
  description: string;
  creatorWallet: string;
};

function findSidecarPath(
  entryPath: string,
  tokenId: number,
  jsonPaths: Set<string>,
): string | undefined {
  const nextToImage = entryPath.replace(/\.(png|jpe?g|webp)$/i, ".json");
  if (jsonPaths.has(nextToImage)) return nextToImage;
  const padded = String(tokenId).padStart(3, "0");
  const suffixes = [
    `metadata/${tokenId}.json`,
    `metadata/${padded}.json`,
    `${tokenId}.json`,
    `${padded}.json`,
  ];
  for (const candidate of jsonPaths) {
    const norm = candidate.replace(/\\/g, "/");
    if (suffixes.some((suffix) => norm === suffix || norm.endsWith(`/${suffix}`))) {
      return candidate;
    }
  }
  return undefined;
}

async function loadSidecar(
  zipPath: string,
  entryPath: string,
  tokenId: number,
  jsonPaths: Set<string>,
): Promise<{ attributes: GeneratedToken["attributes"]; sidecar: GeneratedToken["sidecar"] }> {
  const candidate = findSidecarPath(entryPath, tokenId, jsonPaths);
  if (!candidate) return { attributes: [], sidecar: { present: false } };
  try {
    const raw = await readZipTextEntry(zipPath, candidate);
    if (!raw) return { attributes: [], sidecar: { present: false } };
    const meta = JSON.parse(raw);
    return { attributes: meta.attributes ?? [], sidecar: parseSidecarJson(meta) };
  } catch {
    return { attributes: [], sidecar: { present: false } };
  }
}

export async function runImageImportJob(params: ImageImportParams): Promise<void> {
  const { collectionId, zipUrl } = params;
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
      const { attributes, sidecar } = await loadSidecar(tmpZip!, entryPath, tokenId, jsonPaths);

      tokens.push({
        tokenId,
        dna: attributes.map((a) => String(a.value)).join("|"),
        attributes,
        sidecar,
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
    await updateCollection(collectionId, (current) => {
      const seeded = seedCollectionFromSidecars(current, ranked, jsonPaths.size);
      return {
        ...seeded,
        status: "draft",
        supply: ranked.length,
        pendingZipUrl: undefined,
        importProgress: undefined,
        updatedAt: new Date().toISOString(),
      };
    });
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

  const jsonPaths = new Set(
    Object.keys(zip.files).filter(
      (p) => p.toLowerCase().endsWith(".json") && !p.includes("__MACOSX") && !zip.files[p]?.dir,
    ),
  );

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
    const padded = `metadata/${String(i).padStart(3, "0")}.json`;
    const jsonFile =
      zip.file(jsonName) ??
      zip.file(`metadata/${i}.json`) ??
      zip.file(padded) ??
      Object.entries(zip.files).find(([p, e]) => {
        if (e.dir) return false;
        const norm = p.replace(/\\/g, "/");
        return (
          norm.endsWith(`/metadata/${i}.json`) ||
          norm.endsWith(`/metadata/${String(i).padStart(3, "0")}.json`) ||
          norm === `${i}.json` ||
          norm.endsWith(`/${i}.json`)
        );
      })?.[1];
    let attributes: GeneratedToken["attributes"] = [];
    let sidecar: GeneratedToken["sidecar"] = { present: false };
    if (jsonFile) {
      try {
        const meta = JSON.parse(await jsonFile.async("string"));
        attributes = meta.attributes ?? [];
        sidecar = parseSidecarJson(meta);
      } catch {
        attributes = [];
      }
    }
    tokens.push({
      tokenId: i,
      dna: attributes.map((a) => String(a.value)).join("|"),
      attributes,
      sidecar,
      imageRelPath: `images/${i}${safeExt}`,
      metadataRelPath: `metadata/${i}.json`,
      imageUri,
    });
    i += 1;
  }

  const ranked = assignRarityRanks(tokens);
  const stub = buildImportingCollectionStub({ id, name, description, creatorWallet });
  const collection: Collection = {
    ...seedCollectionFromSidecars(stub, ranked, jsonPaths.size),
    status: "draft",
    supply: ranked.length,
    importProgress: undefined,
  };
  await saveCollection(collection);
  return collection;
}
