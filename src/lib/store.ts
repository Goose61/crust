import { getCollectionsCol } from "./db";
import type { Collection } from "./types";

function asCollection(doc: Collection & { _id?: unknown }): Collection {
  const { _id, ...rest } = doc;
  void _id;
  return rest;
}

export async function listCollections(): Promise<Collection[]> {
  const col = await getCollectionsCol();
  const docs = await col.find({}, { projection: { _id: 0 } }).toArray();
  return docs.map(asCollection);
}

export async function getCollection(id: string): Promise<Collection | null> {
  const col = await getCollectionsCol();
  const doc = await col.findOne(
    { $or: [{ id }, { slug: id }] },
    { projection: { _id: 0 } },
  );
  return doc ? asCollection(doc) : null;
}

export async function saveCollection(collection: Collection): Promise<Collection> {
  const col = await getCollectionsCol();
  collection.updatedAt = new Date().toISOString();
  await col.replaceOne({ id: collection.id }, collection, { upsert: true });
  return collection;
}

export async function updateCollection(
  id: string,
  fn: (current: Collection) => Collection | Promise<Collection>,
): Promise<Collection | null> {
  const col = await getCollectionsCol();
  const doc = await col.findOne(
    { $or: [{ id }, { slug: id }] },
    { projection: { _id: 0 } },
  );
  if (!doc) return null;
  const current = asCollection(doc);
  const next = await fn(current);
  next.updatedAt = new Date().toISOString();
  await col.replaceOne({ id: next.id }, next, { upsert: true });
  return next;
}

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "collection"
  );
}

export function newId() {
  return crypto.randomUUID();
}
