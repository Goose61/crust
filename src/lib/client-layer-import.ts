/**
 * Parse trait-layer ZIP in the browser and store layer PNGs in IndexedDB.
 */

import JSZip from "jszip";
import { putLayer } from "@/lib/client-asset-store";
import type { LayerCatalog } from "@/lib/types";
import { MAX_CLIENT_ZIP_BYTES } from "@/lib/client-zip-import";

const SKIP = /(^|\/)(__MACOSX|\.DS_Store)/;

export type ClientLayerImportProgress = {
  phase: "reading" | "parsing" | "storing";
  done: number;
  total: number;
};

export type ClientLayerImportResult = {
  layers: LayerCatalog[];
  stackOrder: string[];
};

export async function parseLayerZipClient(
  file: File,
  collectionId: string,
  onProgress?: (p: ClientLayerImportProgress) => void,
): Promise<ClientLayerImportResult> {
  if (file.size > MAX_CLIENT_ZIP_BYTES) {
    throw new Error("Upload too large (max 500 MB)");
  }

  onProgress?.({ phase: "reading", done: 0, total: 1 });
  const buffer = await file.arrayBuffer();

  onProgress?.({ phase: "parsing", done: 0, total: 1 });
  const zip = await JSZip.loadAsync(buffer);
  const byType = new Map<string, Map<string, Uint8Array>>();
  let fileCount = 0;

  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir || SKIP.test(entryPath)) continue;
    if (!/\.(png|webp|jpe?g)$/i.test(entryPath)) continue;
    const parts = entryPath.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const fileName = parts[parts.length - 1];
    const traitType = parts[parts.length - 2];
    const value = fileName.replace(/\.(png|webp|jpe?g)$/i, "");
    fileCount += 1;
    const buf = await entry.async("uint8array");
    if (!byType.has(traitType)) byType.set(traitType, new Map());
    byType.get(traitType)!.set(value, buf);
  }

  if (fileCount === 0) {
    throw new Error("No layer PNGs found in ZIP (use folders like Background/Blue.png)");
  }

  const stackOrder = Array.from(byType.keys());
  let stored = 0;

  for (const [traitType, vals] of byType.entries()) {
    for (const [value, buf] of vals.entries()) {
      await putLayer(collectionId, traitType, value, buf, "image/png");
      stored += 1;
      onProgress?.({ phase: "storing", done: stored, total: fileCount });
    }
  }

  const layers: LayerCatalog[] = stackOrder.map((traitType) => ({
    traitType,
    values: Array.from(byType.get(traitType)!.keys()).map((value) => ({
      value,
      fileName: `${value}.png`,
      weight: 100,
    })),
  }));

  return { layers, stackOrder };
}
