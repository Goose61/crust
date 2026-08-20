import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error(
    "MONGODB_URI is not set. Add it to your .env.local:\n" +
      "MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/crypgo?retryWrites=true&w=majority",
  );
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  const client = new MongoClient(uri);
  clientPromise = client.connect();
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db("crypgo");
}

export async function getCollectionsCol() {
  const db = await getDb();
  const col = db.collection("collections");
  await col.createIndex({ id: 1 }, { unique: true, background: true });
  await col.createIndex({ slug: 1 }, { background: true });
  return col;
}
