/**
 * Parse finished-art ZIP in the browser and store images in IndexedDB.
 */

import JSZip from "jszip";
import { assignRarityRanks } from "@/lib/rarity";
import { parseSidecarJson } from "@/lib/metadata-review";
import { findSidecarPath, inferJsonIndexBase, isTokenSidecarJsonPath } from "@/lib/sidecar-matching";
import { putImage } from "@/lib/client-asset-store";
import type { GeneratedToken } from "@/lib/types";

export const MAX_CLIENT_ZIP_BYTES = 500 * 1024 * 1024;

const SKIP = /(^|\/)(__MACOSX|\.DS_Store)/;

export type ClientZipImportProgress = {
  phase: "reading" | "parsing" | "storing";
  done: number;
  total: number;
};

function contentTypeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".webp") return "image/webp";
  if (e === ".png") return "image/png";
  if (e === ".jpeg" || e === ".jpg") return "image/jpeg";
  return "image/png";
}

async function loadSidecarFromZip(
  zip: JSZip,
  entryPath: string,
  tokenId: number,
  jsonPaths: Set<string>,
  tokenCount: number,
): Promise<{ attributes: GeneratedToken["attributes"]; sidecar: GeneratedToken["sidecar"] }> {
  const indexBase = inferJsonIndexBase(jsonPaths, tokenCount);
  const candidate = findSidecarPath(entryPath, tokenId, jsonPaths, {
    tokenCount,
    indexBase,
  });
  if (!candidate) return { attributes: [], sidecar: { present: false } };
  const file = zip.file(candidate);
  if (!file) return { attributes: [], sidecar: { present: false } };
  try {
    const raw = await file.async("string");
    const meta = JSON.parse(raw);
    return { attributes: meta.attributes ?? [], sidecar: parseSidecarJson(meta) };
  } catch {
    return { attributes: [], sidecar: { present: false } };
  }
}

export type ClientReadyImportResult = {
  tokens: GeneratedToken[];
  sidecarJsonCount: number;
};

export async function parseReadyArtZip(
  file: File,
  collectionId: string,
  onProgress?: (p: ClientZipImportProgress) => void,
): Promise<ClientReadyImportResult> {
  if (file.size > MAX_CLIENT_ZIP_BYTES) {
    throw new Error("Upload too large (max 500 MB)");
  }

  onProgress?.({ phase: "reading", done: 0, total: 1 });
  const buffer = await file.arrayBuffer();

  onProgress?.({ phase: "parsing", done: 0, total: 1 });
  const zip = await JSZip.loadAsync(buffer);

  const imageEntries = Object.entries(zip.files)
    .filter(
      ([p, e]) =>
        !e.dir &&
        !SKIP.test(p) &&
        /\.(png|jpe?g|webp)$/i.test(p),
    )
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  if (imageEntries.length === 0) {
    throw new Error("No images found in ZIP");
  }

  const jsonPaths = new Set(
    Object.keys(zip.files).filter(
      (p) =>
        p.toLowerCase().endsWith(".json") &&
        !p.includes("__MACOSX") &&
        !zip.files[p]?.dir &&
        isTokenSidecarJsonPath(p),
    ),
  );

  const tokens: GeneratedToken[] = [];
  const total = imageEntries.length;

  for (let index = 0; index < imageEntries.length; index++) {
    const [entryPath, entry] = imageEntries[index];
    const tokenId = index + 1;
    const ext = entryPath.match(/\.(png|jpe?g|webp)$/i)?.[0] ?? ".png";
    const safeExt = ext.toLowerCase() === ".jpg" ? ".jpeg" : ext.toLowerCase();
    const contentType = contentTypeForExt(safeExt);

    const imageBuf = await entry.async("uint8array");
    await putImage(collectionId, tokenId, imageBuf, contentType);

    const { attributes, sidecar } = await loadSidecarFromZip(
      zip,
      entryPath,
      tokenId,
      jsonPaths,
      total,
    );

    tokens.push({
      tokenId,
      dna: attributes.map((a) => String(a.value)).join("|"),
      attributes,
      sidecar,
      imageRelPath: `images/${tokenId}${safeExt}`,
      metadataRelPath: `metadata/${tokenId}.json`,
    });

    onProgress?.({ phase: "storing", done: tokenId, total });
  }

  const ranked = assignRarityRanks(tokens);
  return { tokens: ranked, sidecarJsonCount: jsonPaths.size };
}
