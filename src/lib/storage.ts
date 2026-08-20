import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { tmpImagesDir, tmpMetadataDir, blobImagePath, blobMetadataPath } from "./paths";
import { uploadBlob, uploadBlobText } from "./blob-storage";
import type { Collection, GeneratedToken } from "./types";

export type PublishResult = {
  provider: "arweave" | "blob" | "staging";
  imageGatewayBase: string;
  tokens: GeneratedToken[];
};

/**
 * Publish generated assets.
 * Priority: Arweave (via Irys) → Vercel Blob → local staging URLs.
 */
export async function publishCollection(collection: Collection): Promise<PublishResult> {
  const tokens = [...collection.tokens];
  const key = process.env.ARWEAVE_SOLANA_KEY;

  if (key) {
    try {
      const { Uploader } = await import(/* webpackIgnore: true */ "@irys/upload");
      const solanaMod = await import(/* webpackIgnore: true */ "@irys/upload-solana");
      const Solana = solanaMod.Solana ?? solanaMod.default;
      const uploader = await Uploader(Solana).withWallet(key);

      for (const token of tokens) {
        const localImg = path.join(tmpImagesDir(collection.id), `${token.tokenId}.png`);
        let imgBuf: Buffer;
        if (existsSync(localImg)) {
          imgBuf = await readFile(localImg);
        } else if (token.imageUri) {
          const res = await fetch(token.imageUri);
          imgBuf = Buffer.from(await res.arrayBuffer());
        } else {
          continue;
        }

        const imgReceipt = await uploader.upload(imgBuf, {
          tags: [{ name: "Content-Type", value: "image/png" }],
        });
        token.imageUri = `https://gateway.irys.xyz/${imgReceipt.id}`;

        const localMeta = path.join(tmpMetadataDir(collection.id), `${token.tokenId}.json`);
        let meta: Record<string, unknown>;
        if (existsSync(localMeta)) {
          meta = JSON.parse(await readFile(localMeta, "utf8"));
        } else if (token.metadataUri) {
          const res = await fetch(token.metadataUri);
          meta = await res.json();
        } else {
          continue;
        }

        meta.image = token.imageUri;
        if (
          meta.properties &&
          typeof meta.properties === "object" &&
          Array.isArray((meta.properties as { files?: unknown[] }).files)
        ) {
          (meta.properties as { files: { uri: string }[] }).files[0].uri = token.imageUri;
        }

        const metaReceipt = await uploader.upload(JSON.stringify(meta), {
          tags: [{ name: "Content-Type", value: "application/json" }],
        });
        token.metadataUri = `https://gateway.irys.xyz/${metaReceipt.id}`;
      }

      return {
        provider: "arweave",
        imageGatewayBase: "https://gateway.irys.xyz",
        tokens,
      };
    } catch (err) {
      console.error("Arweave publish failed, falling back to Blob/staging", err);
    }
  }

  // Blob / staging fallback: re-upload if tokens don't already have URIs
  for (const token of tokens) {
    if (!token.imageUri) {
      const localImg = path.join(tmpImagesDir(collection.id), `${token.tokenId}.png`);
      if (existsSync(localImg)) {
        token.imageUri = await uploadBlob(
          blobImagePath(collection.id, token.tokenId),
          await readFile(localImg),
          "image/png",
        );
      }
    }
    if (!token.metadataUri) {
      const localMeta = path.join(tmpMetadataDir(collection.id), `${token.tokenId}.json`);
      if (existsSync(localMeta)) {
        token.metadataUri = await uploadBlobText(
          blobMetadataPath(collection.id, token.tokenId),
          await readFile(localMeta, "utf8"),
        );
      }
    }
    // If already uploaded to Blob during generation, URIs are already set
  }

  const provider = process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "staging";
  return {
    provider,
    imageGatewayBase:
      provider === "blob" ? "https://blob.vercel-storage.com" : `/api/assets/${collection.id}`,
    tokens,
  };
}
