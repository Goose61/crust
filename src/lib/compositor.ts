import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import sharp from "sharp";
import JSZip from "jszip";
import type { GeneratedToken, LayerCatalog, MetadataCreator, RoyaltySplit } from "./types";
import {
  tmpImagesDir,
  tmpMetadataDir,
  tmpLayersDir,
  blobLayerPath,
  blobImagePath,
  blobMetadataPath,
} from "./paths";
import { uploadBlob, uploadBlobText, downloadBlobToTmp } from "./blob-storage";
import { buildTokenMetadataJson } from "./metadata-builders";
import { parseSidecarJson } from "./metadata-review";
import { assignRarityRanks } from "./rarity";

export { assignRarityRanks };

const SKIP = /(^|\/)(__MACOSX|\.DS_Store)/;

export type ParsedZip = {
  layers: LayerCatalog[];
  stackOrder: string[];
  files: { traitType: string; value: string; buffer: Buffer }[];
};

export async function parseLayerZip(buffer: Buffer): Promise<ParsedZip> {
  const zip = await JSZip.loadAsync(buffer);
  const files: ParsedZip["files"] = [];
  const byType = new Map<string, Map<string, Buffer>>();

  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir || SKIP.test(entryPath)) continue;
    if (!/\.(png|webp|jpe?g)$/i.test(entryPath)) continue;
    const parts = entryPath.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const fileName = parts[parts.length - 1];
    const traitType = parts[parts.length - 2];
    const value = fileName.replace(/\.(png|webp|jpe?g)$/i, "");
    const buf = Buffer.from(await entry.async("uint8array"));
    files.push({ traitType, value, buffer: buf });
    if (!byType.has(traitType)) byType.set(traitType, new Map());
    byType.get(traitType)!.set(value, buf);
  }

  const stackOrder = Array.from(byType.keys());
  const layers: LayerCatalog[] = stackOrder.map((traitType) => ({
    traitType,
    values: Array.from(byType.get(traitType)!.keys()).map((value) => ({
      value,
      fileName: `${value}.png`,
      weight: 100,
    })),
  }));

  return { layers, stackOrder, files };
}

/** Upload parsed layer files to Blob (or local staging in dev) and return updated layers with blobUrls. */
export async function persistLayerFiles(
  collectionId: string,
  files: ParsedZip["files"],
): Promise<LayerCatalog[]> {
  const blobUrlMap = new Map<string, Map<string, string>>();

  for (const file of files) {
    const blobPath = blobLayerPath(collectionId, file.traitType, file.value);
    const url = await uploadBlob(blobPath, file.buffer, "image/png");
    if (!blobUrlMap.has(file.traitType)) blobUrlMap.set(file.traitType, new Map());
    blobUrlMap.get(file.traitType)!.set(file.value, url);
  }

  // Return updated LayerCatalog entries with blobUrls
  const result: LayerCatalog[] = Array.from(blobUrlMap.entries()).map(([traitType, vals]) => ({
    traitType,
    values: Array.from(vals.entries()).map(([value, blobUrl]) => ({
      value,
      fileName: `${value}.png`,
      weight: 100,
      blobUrl,
    })),
  }));
  return result;
}

/** Ensure a layer file is present in /tmp; download from Blob if needed. */
async function ensureLayerFile(
  traitType: string,
  value: string,
  blobUrl: string | undefined,
  collectionId: string,
): Promise<string | null> {
  const localPath = path.join(tmpLayersDir(collectionId), traitType, `${value}.png`);
  if (existsSync(localPath)) return localPath;
  if (!blobUrl) return null;
  try {
    await downloadBlobToTmp(blobUrl, localPath);
    return localPath;
  } catch {
    return null;
  }
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

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type GenerateOptions = {
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
};

export async function generateCollection(opts: GenerateOptions) {
  const rng = mulberry32(opts.seed ?? Date.now() % 1_000_000);
  const count = opts.previewCount ?? opts.supply;
  const imagesDir = tmpImagesDir(opts.collectionId);
  const metaDir = tmpMetadataDir(opts.collectionId);
  await mkdir(imagesDir, { recursive: true });
  await mkdir(metaDir, { recursive: true });

  const layersByType = new Map(opts.layers.map((l) => [l.traitType, l]));
  const tokens: GeneratedToken[] = [];
  const seen = new Set<string>();

  for (let i = 1; i <= count; i++) {
    let attributes: { trait_type: string; value: string }[] = [];
    let dna = "";
    let attempts = 0;
    do {
      attributes = opts.stackOrder.map((traitType) => {
        const layer = layersByType.get(traitType);
        if (!layer || layer.values.length === 0) {
          return { trait_type: traitType, value: "None" };
        }
        const picked = pickWeighted(layer.values, rng);
        return { trait_type: traitType, value: picked.value };
      });
      dna = attributes.map((a) => a.value).join("|");
      attempts += 1;
    } while (opts.uniqueness && seen.has(dna) && attempts < 200);

    if (opts.uniqueness && seen.has(dna)) {
      throw new Error(
        `Could not generate unique DNA for token #${i}. Reduce supply or add more trait values.`,
      );
    }

    seen.add(dna);

    const buffers: Buffer[] = [];
    for (const attr of attributes) {
      const layer = layersByType.get(attr.trait_type);
      const layerValue = layer?.values.find((v) => v.value === attr.value);
      const filePath = await ensureLayerFile(
        attr.trait_type,
        attr.value,
        layerValue?.blobUrl,
        opts.collectionId,
      );
      if (!filePath) continue;
      try {
        buffers.push(await sharp(filePath).png().toBuffer());
      } catch {
        /* skip missing layer file */
      }
    }

    let imageBuffer: Buffer;
    if (buffers.length === 0) {
      imageBuffer = await sharp({
        create: { width: 512, height: 512, channels: 4, background: { r: 28, g: 22, b: 18, alpha: 1 } },
      })
        .png()
        .toBuffer();
    } else {
      const base = sharp(buffers[0]);
      const rest = buffers.slice(1).map((input) => ({ input }));
      imageBuffer = await base.composite(rest).png().toBuffer();
    }

    const imageRelPath = `images/${i}.png`;
    const localImagePath = path.join(imagesDir, `${i}.png`);
    await writeFile(localImagePath, imageBuffer);

    // Upload generated image to Blob immediately
    const imageUri = await uploadBlob(
      blobImagePath(opts.collectionId, i),
      imageBuffer,
      "image/png",
    );

    const token: GeneratedToken = {
      tokenId: i,
      dna,
      attributes,
      imageRelPath,
      metadataRelPath: `metadata/${i}.json`,
      imageUri,
    };
    tokens.push(token);
  }

  const ranked = assignRarityRanks(tokens);
  for (const token of ranked) {
    const name = opts.nameTemplate
      .replace("{name}", opts.name)
      .replace("{id}", String(token.tokenId));
    const metadata = buildTokenMetadataJson({
      name,
      symbol: opts.symbol || opts.name.slice(0, 8).toUpperCase(),
      description: opts.description,
      sellerFeeBps: opts.sellerFeeBps,
      image: token.imageUri ?? token.imageRelPath,
      attributes: token.attributes,
      creatorWallet: opts.creatorWallet,
      royaltySplit: opts.royaltySplit,
      royaltyCreators: opts.royaltyCreators,
    });
    const metaJson = JSON.stringify(metadata, null, 2);
    const localMetaPath = path.join(metaDir, `${token.tokenId}.json`);
    await writeFile(localMetaPath, metaJson);

    token.metadataUri = await uploadBlobText(
      blobMetadataPath(opts.collectionId, token.tokenId),
      metaJson,
    );
    token.sidecar = parseSidecarJson(metadata);
  }

  return ranked;
}

export async function tokenPreviewPng(collectionId: string, tokenId: number) {
  const localPath = path.join(tmpImagesDir(collectionId), `${tokenId}.png`);
  if (existsSync(localPath)) return localPath;
  return null;
}

/** Read a generated image for inline preview (returns Buffer or null). */
export async function readGeneratedImageBuffer(collectionId: string, tokenId: number): Promise<Buffer | null> {
  const localPath = path.join(tmpImagesDir(collectionId), `${tokenId}.png`);
  if (existsSync(localPath)) {
    return readFile(localPath);
  }
  return null;
}
