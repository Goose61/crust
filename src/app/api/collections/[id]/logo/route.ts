import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getCollection, saveCollection } from "@/lib/store";
import { uploadBlob } from "@/lib/blob-storage";
import { blobLogoPath } from "@/lib/paths";
import { readAuthHeaders, assertCreatorAuth } from "@/lib/wallet-auth";
import { toPublicCollection } from "@/lib/public-collection";
import { isServerArweaveUploadAvailable, uploadToArweaveServer } from "@/lib/irys-server";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const collection = await getCollection(id);
    if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });

    const auth = readAuthHeaders(req);
    try {
      assertCreatorAuth(auth, collection.payments.creatorWallet);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unauthorized";
      return NextResponse.json({ error: message }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Image file required" }, { status: 400 });
    }
    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: "Logo too large (max 10 MB)" }, { status: 413 });
    }

    const ext = (path.extname(file.name) || ".png").toLowerCase();
    const safeExt = ext === ".jpg" ? ".jpeg" : ext;
    const contentType = ALLOWED_MIME.has(file.type) ? file.type : "image/png";

    const buf = Buffer.from(await file.arrayBuffer());
    if (!isAllowedImageMagic(buf)) {
      return NextResponse.json({ error: "Invalid image file" }, { status: 400 });
    }

    const logoUrl = await persistLogo(id, buf, contentType, safeExt);
    const updated = await saveCollection({ ...collection, logoUrl });
    return NextResponse.json({ logoUrl, collection: toPublicCollection(updated) });
  } catch (e) {
    console.error("[POST /api/collections/:id/logo]", e);
    const message = e instanceof Error ? e.message : "Could not upload logo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function blobLooksSuspended(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /vercel blob|store has been suspended|blob_read_write_token/i.test(message);
}

async function prepareLogo(
  buf: Buffer,
  contentType: string,
  ext: string,
): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const webp = await sharp(buf)
      .rotate()
      .resize(512, 512, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
    return { buffer: webp, contentType: "image/webp", ext: ".webp" };
  } catch {
    return { buffer: buf, contentType, ext };
  }
}

/** Prefer Irys so logos survive the suspended Vercel Blob store. */
async function persistLogo(
  collectionId: string,
  buf: Buffer,
  contentType: string,
  ext: string,
): Promise<string> {
  const prepared = await prepareLogo(buf, contentType, ext);
  if (isServerArweaveUploadAvailable()) {
    try {
      return await uploadToArweaveServer(prepared.buffer, prepared.contentType, {
        collectionId,
      });
    } catch (err) {
      console.error("[logo] Irys upload failed, trying fallback", err);
    }
  }
  try {
    return await uploadBlob(
      blobLogoPath(collectionId, prepared.ext),
      prepared.buffer,
      prepared.contentType,
    );
  } catch (err) {
    if (!blobLooksSuspended(err)) throw err;
  }
  const b64 = prepared.buffer.toString("base64");
  if (b64.length > 350_000) {
    throw new Error(
      "Could not store logo. Vercel Blob is suspended and the image is too large for inline storage.",
    );
  }
  return `data:${prepared.contentType};base64,${b64}`;
}

function isAllowedImageMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true;
  return false;
}
