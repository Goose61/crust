import { getCollectionsCol } from "./db";
import type { Collection } from "./types";
import { tokenIsCommitted } from "./public-collection";

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

export function committedCount(collection: Collection): number {
  return collection.tokens.filter(tokenIsCommitted).length;
}

/** Atomically reserve a token that is not owned or reserved. */
export async function tryReserveToken(
  id: string,
  tokenId: number,
  reservedBy: string,
): Promise<Collection | null> {
  const col = await getCollectionsCol();
  const now = new Date().toISOString();
  const result = await col.findOneAndUpdate(
    {
      $or: [{ id }, { slug: id }],
      tokens: {
        $elemMatch: {
          tokenId,
          $nor: [{ owner: { $type: "string" } }, { reservedBy: { $type: "string" } }],
        },
      },
    },
    {
      $set: {
        "tokens.$.reservedBy": reservedBy,
        "tokens.$.reservedAt": now,
        updatedAt: now,
      },
    },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return result ? asCollection(result) : null;
}

/** Atomically assign ownership to an available (or already reserved-by) token. */
export async function tryAssignTokenOwner(
  id: string,
  tokenId: number,
  owner: string,
  opts: { requireReservedBy?: string } = {},
): Promise<Collection | null> {
  const col = await getCollectionsCol();
  const now = new Date().toISOString();
  const elemMatch: Record<string, unknown> = { tokenId };
  if (opts.requireReservedBy) {
    elemMatch.reservedBy = opts.requireReservedBy;
    elemMatch.$nor = [{ owner: { $type: "string" } }];
  } else {
    elemMatch.$nor = [{ owner: { $type: "string" } }, { reservedBy: { $type: "string" } }];
  }
  const result = await col.findOneAndUpdate(
    {
      $or: [{ id }, { slug: id }],
      tokens: { $elemMatch: elemMatch },
    },
    {
      $set: { "tokens.$.owner": owner, updatedAt: now },
      $unset: { "tokens.$.reservedBy": "", "tokens.$.reservedAt": "" },
    },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return result ? asCollection(result) : null;
}

export async function clearTokenReservation(
  id: string,
  tokenId: number,
): Promise<Collection | null> {
  const col = await getCollectionsCol();
  const now = new Date().toISOString();
  const result = await col.findOneAndUpdate(
    {
      $or: [{ id }, { slug: id }],
      tokens: { $elemMatch: { tokenId, reservedBy: { $type: "string" } } },
    },
    {
      $unset: { "tokens.$.reservedBy": "", "tokens.$.reservedAt": "" },
      $set: { updatedAt: now },
    },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return result ? asCollection(result) : null;
}

export async function tryClearTokenOwner(
  id: string,
  tokenId: number,
  expectedOwner: string,
): Promise<Collection | null> {
  const col = await getCollectionsCol();
  const now = new Date().toISOString();
  const result = await col.findOneAndUpdate(
    {
      $or: [{ id }, { slug: id }],
      tokens: { $elemMatch: { tokenId, owner: expectedOwner } },
    },
    {
      $unset: { "tokens.$.owner": "", "tokens.$.reservedBy": "", "tokens.$.reservedAt": "" },
      $set: { updatedAt: now },
    },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return result ? asCollection(result) : null;
}
