import { NextRequest, NextResponse } from "next/server";
import { getCollection, saveCollection } from "@/lib/store";
import { readAuthHeaders, assertCreatorAuth } from "@/lib/wallet-auth";
import { toPublicCollection } from "@/lib/public-collection";
import { isServerArweaveUploadAvailable, uploadToArweaveServer } from "@/lib/irys-server";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 10 * 1024 * 1024; // 10 MB
const TARGET_LOGO_BYTES = 80 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const COMPRESS_STEPS = [
  { size: 384, quality: 72 },
  { size: 256, quality: 64 },
  { size: 192, quality: 52 },
  { size: 128, quality: 44 },
] as const;

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

    const contentType = ALLOWED_MIME.has(file.type) ? file.type : "image/png";
    const buf = Buffer.from(await file.arrayBuffer());
    if (!isAllowedImageMagic(buf)) {
      return NextResponse.json({ error: "Invalid image file" }, { status: 400 });
    }

    const logoUrl = await persistLogo(id, buf, contentType);
    const updated = await saveCollection({ ...collection, logoUrl });
    return NextResponse.json({ logoUrl, collection: toPublicCollection(updated) });
  } catch (e) {
    console.error("[POST /api/collections/:id/logo]", e);
    const message = e instanceof Error ? e.message : "Could not upload logo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function compressLogo(buf: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  let last: Buffer | null = null;
  for (const step of COMPRESS_STEPS) {
    last = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize(step.size, step.size, { fit: "cover" })
      .webp({ quality: step.quality })
      .toBuffer();
    if (last.length <= TARGET_LOGO_BYTES) return last;
  }
  if (!last) throw new Error("Could not compress logo");
  return last;
}

/**
 * Never fund the platform Irys wallet for a logo — that wallet is nearly empty
 * and Vercel Blob is suspended. Compress first, try leftover Irys credit, then
 * store a data URL which always fits after compression.
 */
async function persistLogo(
  collectionId: string,
  buf: Buffer,
  _contentType: string,
): Promise<string> {
  let prepared: Buffer;
  try {
    prepared = await compressLogo(buf);
  } catch (err) {
    console.error("[logo] compress failed", err);
    throw new Error("Could not process that image. Try a PNG or JPEG under 2 MB.");
  }

  const contentType = "image/webp";
  if (isServerArweaveUploadAvailable()) {
    try {
      return await uploadToArweaveServer(prepared, contentType, {
        collectionId,
        skipFund: true,
        requirePosted: true,
      });
    } catch (err) {
      console.error("[logo] Irys upload skipped, storing inline", err);
    }
  }

  return `data:${contentType};base64,${prepared.toString("base64")}`;
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
