import path from "path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const COLLECTIONS_FILE = path.join(DATA_DIR, "collections.json");
export const STAGING_DIR = path.join(DATA_DIR, "staging");
export const LAYERS_DIR = path.join(DATA_DIR, "layers");

// Persistent staging paths (local dev only)
export function collectionDir(id: string) {
  return path.join(STAGING_DIR, id);
}
export function collectionImagesDir(id: string) {
  return path.join(collectionDir(id), "images");
}
export function collectionMetadataDir(id: string) {
  return path.join(collectionDir(id), "metadata");
}
export function collectionLayersDir(id: string) {
  return path.join(LAYERS_DIR, id);
}

// /tmp paths — writable on Vercel serverless, ephemeral per invocation
export function tmpCollectionDir(id: string) {
  return path.join("/tmp", "staging", id);
}
export function tmpImagesDir(id: string) {
  return path.join(tmpCollectionDir(id), "images");
}
export function tmpMetadataDir(id: string) {
  return path.join(tmpCollectionDir(id), "metadata");
}
export function tmpLayersDir(id: string) {
  return path.join("/tmp", "layers", id);
}

/** Blob storage prefix helpers (pathname inside the bucket). */
export function blobLayerPath(collectionId: string, traitType: string, value: string) {
  return `layers/${collectionId}/${traitType}/${value}.png`;
}
export function blobImagePath(collectionId: string, tokenId: number) {
  return `staging/${collectionId}/images/${tokenId}.png`;
}
export function blobMetadataPath(collectionId: string, tokenId: number) {
  return `staging/${collectionId}/metadata/${tokenId}.json`;
}
export function blobLogoPath(collectionId: string, ext: string) {
  return `collections/${collectionId}/logo${ext}`;
}
