/**
 * Browser IndexedDB store for launch draft assets (images, layers, logo)
 * and Arweave upload checkpoints. Replaces Vercel Blob during the wizard.
 */

const DB_NAME = "crypgo-launch";
const DB_VERSION = 1;
const ASSET_STORE = "assets";
const PROGRESS_STORE = "uploadProgress";

export type StoredAsset = {
  contentType: string;
  data: ArrayBuffer;
};

export type TokenUploadProgress = {
  imageUri: string;
  metadataUri: string;
};

export type CollectionUploadProgress = {
  completed: Record<number, TokenUploadProgress>;
  logoUri?: string;
};

function imageKey(collectionId: string, tokenId: number): string {
  return `img:${collectionId}:${tokenId}`;
}

function layerKey(collectionId: string, traitType: string, value: string): string {
  return `layer:${collectionId}:${traitType}:${value}`;
}

function logoKey(collectionId: string): string {
  return `logo:${collectionId}`;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this browser"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("Could not open IndexedDB"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE);
      }
      if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
        db.createObjectStore(PROGRESS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    req.onsuccess = () => resolve(req.result as T | undefined);
    tx.oncomplete = () => db.close();
  });
}

async function idbPut(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value, key);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB write failed"));
    req.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
  });
}

async function idbDeletePrefix(prefix: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, "readwrite");
    const store = tx.objectStore(ASSET_STORE);
    const req = store.openCursor();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const key = String(cursor.key);
        if (key.startsWith(prefix)) cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

export async function putImage(
  collectionId: string,
  tokenId: number,
  data: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  await idbPut(ASSET_STORE, imageKey(collectionId, tokenId), { contentType, data: buf });
}

export async function getImage(
  collectionId: string,
  tokenId: number,
): Promise<StoredAsset | undefined> {
  return idbGet<StoredAsset>(ASSET_STORE, imageKey(collectionId, tokenId));
}

export async function putLayer(
  collectionId: string,
  traitType: string,
  value: string,
  data: ArrayBuffer | Uint8Array,
  contentType = "image/png",
): Promise<void> {
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  await idbPut(ASSET_STORE, layerKey(collectionId, traitType, value), { contentType, data: buf });
}

export async function getLayer(
  collectionId: string,
  traitType: string,
  value: string,
): Promise<StoredAsset | undefined> {
  return idbGet<StoredAsset>(ASSET_STORE, layerKey(collectionId, traitType, value));
}

export async function putLogo(
  collectionId: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  await idbPut(ASSET_STORE, logoKey(collectionId), { contentType, data: buf });
}

export async function getLogo(collectionId: string): Promise<StoredAsset | undefined> {
  return idbGet<StoredAsset>(ASSET_STORE, logoKey(collectionId));
}

/** True if at least one image or layer exists for this collection. */
export async function hasAssets(collectionId: string): Promise<boolean> {
  const db = await openDb();
  const prefix = `img:${collectionId}:`;
  const layerPrefix = `layer:${collectionId}:`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, "readonly");
    const store = tx.objectStore(ASSET_STORE);
    const req = store.openCursor();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(false);
        return;
      }
      const key = String(cursor.key);
      if (key.startsWith(prefix) || key.startsWith(layerPrefix) || key === logoKey(collectionId)) {
        resolve(true);
        return;
      }
      cursor.continue();
    };
    tx.oncomplete = () => db.close();
  });
}

export async function countImages(collectionId: string): Promise<number> {
  const db = await openDb();
  const prefix = `img:${collectionId}:`;
  return new Promise((resolve, reject) => {
    let count = 0;
    const tx = db.transaction(ASSET_STORE, "readonly");
    const req = tx.objectStore(ASSET_STORE).openCursor();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(count);
        return;
      }
      if (String(cursor.key).startsWith(prefix)) count += 1;
      cursor.continue();
    };
    tx.oncomplete = () => db.close();
  });
}

export async function clearCollection(collectionId: string): Promise<void> {
  await idbDeletePrefix(`img:${collectionId}:`);
  await idbDeletePrefix(`layer:${collectionId}:`);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([ASSET_STORE, PROGRESS_STORE], "readwrite");
    tx.objectStore(ASSET_STORE).delete(logoKey(collectionId));
    tx.objectStore(PROGRESS_STORE).delete(collectionId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveUploadProgress(
  collectionId: string,
  progress: CollectionUploadProgress,
): Promise<void> {
  await idbPut(PROGRESS_STORE, collectionId, progress);
}

export async function loadUploadProgress(
  collectionId: string,
): Promise<CollectionUploadProgress | undefined> {
  return idbGet<CollectionUploadProgress>(PROGRESS_STORE, collectionId);
}

export async function estimateCollectionBytes(collectionId: string): Promise<number> {
  const db = await openDb();
  const prefixes = [`img:${collectionId}:`, `layer:${collectionId}:`, logoKey(collectionId)];
  return new Promise((resolve, reject) => {
    let total = 0;
    const tx = db.transaction(ASSET_STORE, "readonly");
    const req = tx.objectStore(ASSET_STORE).openCursor();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(total);
        return;
      }
      const key = String(cursor.key);
      if (prefixes.some((p) => key.startsWith(p) || key === p)) {
        const rec = cursor.value as StoredAsset;
        total += rec.data.byteLength;
      }
      cursor.continue();
    };
    tx.oncomplete = () => db.close();
  });
}

/** Sum image bytes + estimated metadata JSON per token (for Arweave cost estimate). */
export async function estimateArweaveBytes(
  collectionId: string,
  tokenCount: number,
): Promise<number> {
  const assetBytes = await estimateCollectionBytes(collectionId);
  const metaPerToken = 900;
  return assetBytes + tokenCount * metaPerToken * 2;
}

export function assetToObjectUrl(asset: StoredAsset): string {
  return URL.createObjectURL(new Blob([asset.data], { type: asset.contentType }));
}

/** Remove all IndexedDB assets and upload progress for a collection draft. */
export async function clearCollectionAssets(collectionId: string): Promise<void> {
  const db = await openDb();
  const prefixes = [`img:${collectionId}:`, `layer:${collectionId}:`, logoKey(collectionId)];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([ASSET_STORE, PROGRESS_STORE], "readwrite");
    for (const storeName of [ASSET_STORE, PROGRESS_STORE]) {
      const store = tx.objectStore(storeName);
      if (storeName === PROGRESS_STORE) {
        store.delete(collectionId);
        continue;
      }
      const req = store.openCursor();
      req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = String(cursor.key);
        if (prefixes.some((p) => key.startsWith(p) || key === p)) {
          cursor.delete();
        }
        cursor.continue();
      };
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"));
  });
}
