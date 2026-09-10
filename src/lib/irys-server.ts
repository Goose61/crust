import { getPlatformSecretKey } from "./platform-key";
import { IRYS_GATEWAY } from "./irys-shared";

type IrysUploader = {
  upload: (
    data: Buffer | string,
    opts: { tags: { name: string; value: string }[] },
  ) => Promise<{ id: string }>;
};

let uploaderPromise: Promise<IrysUploader> | null = null;

export function isServerArweaveUploadAvailable(): boolean {
  return !!getPlatformSecretKey();
}

async function getServerIrysUploader(): Promise<IrysUploader> {
  const key = process.env.ARWEAVE_SOLANA_KEY;
  if (!key) {
    throw new Error(
      "Server Arweave upload is not configured (ARWEAVE_SOLANA_KEY). Contact support or use a smaller collection.",
    );
  }
  if (!uploaderPromise) {
    uploaderPromise = (async () => {
      const { Uploader } = await import("@irys/upload");
      const solanaMod = await import("@irys/upload-solana");
      const Solana = solanaMod.Solana ?? solanaMod.default;
      return Uploader(Solana).withWallet(key) as Promise<IrysUploader>;
    })();
  }
  return uploaderPromise;
}

/** Upload to Arweave via the platform Irys wallet — no per-file browser signatures. */
export async function uploadToArweaveServer(
  data: Buffer,
  contentType: string,
): Promise<string> {
  const uploader = await getServerIrysUploader();
  const receipt = await uploader.upload(data, {
    tags: [{ name: "Content-Type", value: contentType }],
  });
  return `${IRYS_GATEWAY}/${receipt.id}`;
}
