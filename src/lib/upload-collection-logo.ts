import { buildAuthHeaders } from "@/lib/wallet-auth-client";
import { readJsonResponse } from "@/lib/fetch-json";
import type { Collection } from "@/lib/types";

const TARGET_BYTES = 80 * 1024;
const SIZES = [384, 256, 192, 128] as const;
const QUALITIES = [0.72, 0.6, 0.48, 0.36];

function containDraw(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  size: number,
) {
  ctx.fillStyle = "#161311";
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
  if (!blob) throw new Error("Could not encode logo");
  return blob;
}

/** Resize/compress in the browser so the server never needs sharp. */
export async function compressLogoForUpload(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    let best: Blob | null = null;
    for (const size of SIZES) {
      canvas.width = size;
      canvas.height = size;
      containDraw(ctx, bitmap, size);
      for (const quality of QUALITIES) {
        const blob = await canvasToJpeg(canvas, quality);
        best = blob;
        if (blob.size <= TARGET_BYTES) {
          return new File([blob], "logo.jpg", { type: "image/jpeg" });
        }
      }
    }
    if (best) return new File([best], "logo.jpg", { type: "image/jpeg" });
    return file;
  } finally {
    bitmap.close();
  }
}

export async function uploadCollectionLogo(
  collectionId: string,
  file: File,
  wallet: string,
): Promise<{ logoUrl: string; collection?: Collection }> {
  const headers = await buildAuthHeaders(wallet);
  let payload = file;
  try {
    payload = await compressLogoForUpload(file);
  } catch (err) {
    console.warn("[logo] browser compress failed, uploading original", err);
  }
  const form = new FormData();
  form.append("file", payload);
  const res = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/logo`, {
    method: "POST",
    headers,
    body: form,
  });
  const data = await readJsonResponse<{
    logoUrl?: string;
    collection?: Collection;
    error?: string;
  }>(res);
  if (!res.ok || !data.logoUrl) {
    throw new Error(data.error ?? "Could not upload logo");
  }
  return { logoUrl: data.logoUrl, collection: data.collection };
}
