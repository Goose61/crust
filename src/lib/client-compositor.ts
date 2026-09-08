/**
 * Browser Canvas compositor for trait-layer collections.
 * Port of server compositor logic without sharp / Vercel Blob.
 */

import { assignRarityRanks } from "@/lib/rarity";
import { getLayer, putImage } from "@/lib/client-asset-store";
import { buildTokenMetadataJson } from "@/lib/metadata-builders";
import { parseSidecarJson } from "@/lib/metadata-review";
import type { GeneratedToken, LayerCatalog, MetadataCreator, RoyaltySplit } from "@/lib/types";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(values: LayerCatalog["values"], rng: () => number) {
  const total = values.reduce((s, v) => s + Math.max(0, v.weight), 0) || 1;
  let roll = rng() * total;
  for (const v of values) {
    roll -= Math.max(0, v.weight);
    if (roll <= 0) return v;
  }
  return values[values.length - 1];
}

async function loadLayerBitmap(
  collectionId: string,
  traitType: string,
  value: string,
): Promise<ImageBitmap | null> {
  const asset = await getLayer(collectionId, traitType, value);
  if (!asset) return null;
  try {
    return await createImageBitmap(new Blob([asset.data], { type: asset.contentType }));
  } catch {
    return null;
  }
}

async function compositeLayers(
  collectionId: string,
  stackOrder: string[],
  attributes: { trait_type: string; value: string | number }[],
  layersByType: Map<string, LayerCatalog>,
  width = 512,
  height = 512,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.fillStyle = "#1c1612";
  ctx.fillRect(0, 0, width, height);

  let drewAny = false;
  for (const traitType of stackOrder) {
    const attr = attributes.find((a) => a.trait_type === traitType);
    if (!attr) continue;
    const layer = layersByType.get(traitType);
    const layerValue = layer?.values.find((v) => v.value === String(attr.value));
    if (!layerValue) continue;
    const bitmap = await loadLayerBitmap(collectionId, traitType, layerValue.value);
    if (!bitmap) continue;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    drewAny = true;
  }

  if (!drewAny) {
    ctx.fillStyle = "#1c1612";
    ctx.fillRect(0, 0, width, height);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to composite image"))),
      "image/png",
    );
  });
}

export type ClientGenerateOptions = {
  collectionId: string;
  name: string;
  description: string;
  nameTemplate: string;
  symbol?: string;
  supply: number;
  stackOrder: string[];
  layers: LayerCatalog[];
  creatorWallet: string;
  sellerFeeBps: number;
  royaltySplit?: RoyaltySplit;
  royaltyCreators?: MetadataCreator[];
  seed?: number;
  previewCount?: number;
  uniqueness?: boolean;
  onProgress?: (done: number, total: number) => void;
};

function rollAttributes(
  stackOrder: string[],
  layersByType: Map<string, LayerCatalog>,
  rng: () => number,
): { trait_type: string; value: string }[] {
  return stackOrder.map((traitType) => {
    const layer = layersByType.get(traitType);
    if (!layer || layer.values.length === 0) {
      return { trait_type: traitType, value: "None" };
    }
    const picked = pickWeighted(layer.values, rng);
    return { trait_type: traitType, value: picked.value };
  });
}

/** Generate preview composites (does not persist to IndexedDB). */
export async function generatePreviewsClient(
  opts: ClientGenerateOptions,
): Promise<{ tokenId: number; image: string; attributes: GeneratedToken["attributes"] }[]> {
  const rng = mulberry32(opts.seed ?? Date.now() % 1_000_000);
  const count = opts.previewCount ?? 12;
  const layersByType = new Map(opts.layers.map((l) => [l.traitType, l]));
  const previews: { tokenId: number; image: string; attributes: GeneratedToken["attributes"] }[] = [];

  for (let i = 1; i <= count; i++) {
    const attributes = rollAttributes(opts.stackOrder, layersByType, rng);
    const blob = await compositeLayers(opts.collectionId, opts.stackOrder, attributes, layersByType);
    previews.push({
      tokenId: i,
      image: URL.createObjectURL(blob),
      attributes,
    });
  }
  return previews;
}

/** Generate full collection; writes PNGs to IndexedDB. Returns tokens without Arweave URIs. */
export async function generateFullCollectionClient(
  opts: ClientGenerateOptions,
): Promise<GeneratedToken[]> {
  const rng = mulberry32(opts.seed ?? Date.now() % 1_000_000);
  const count = opts.previewCount ?? opts.supply;
  const layersByType = new Map(opts.layers.map((l) => [l.traitType, l]));
  const tokens: GeneratedToken[] = [];
  const seen = new Set<string>();

  for (let i = 1; i <= count; i++) {
    let attributes: GeneratedToken["attributes"] = [];
    let dna = "";
    let attempts = 0;
    do {
      attributes = rollAttributes(opts.stackOrder, layersByType, rng);
      dna = attributes.map((a) => a.value).join("|");
      attempts += 1;
    } while (opts.uniqueness && seen.has(dna) && attempts < 200);

    if (opts.uniqueness && seen.has(dna)) {
      throw new Error(
        `Could not generate unique DNA for token #${i}. Reduce supply or add more trait values.`,
      );
    }
    seen.add(dna);

    const blob = await compositeLayers(opts.collectionId, opts.stackOrder, attributes, layersByType);
    const buf = await blob.arrayBuffer();
    await putImage(opts.collectionId, i, buf, "image/png");

    tokens.push({
      tokenId: i,
      dna,
      attributes,
      imageRelPath: `images/${i}.png`,
      metadataRelPath: `metadata/${i}.json`,
    });

    opts.onProgress?.(i, count);
  }

  const ranked = assignRarityRanks(tokens);
  for (const token of ranked) {
    const metaName = opts.nameTemplate
      .replace("{name}", opts.name)
      .replace("{id}", String(token.tokenId));
    const metadata = buildTokenMetadataJson({
      name: metaName,
      symbol: opts.symbol || opts.name.slice(0, 8).toUpperCase(),
      description: opts.description,
      sellerFeeBps: opts.sellerFeeBps,
      image: token.imageRelPath,
      attributes: token.attributes,
      creatorWallet: opts.creatorWallet,
      royaltySplit: opts.royaltySplit,
      royaltyCreators: opts.royaltyCreators,
    });
    token.sidecar = parseSidecarJson(metadata);
  }

  return ranked;
}

export function revokePreviewUrls(
  previews: { image: string }[],
): void {
  for (const p of previews) {
    if (p.image.startsWith("blob:")) URL.revokeObjectURL(p.image);
  }
}
