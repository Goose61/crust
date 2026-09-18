import { NextRequest, NextResponse } from "next/server";
import { getCollection, saveCollection } from "@/lib/store";
import { readAuthHeaders, assertCreatorAuth } from "@/lib/wallet-auth";
import { toPublicCollection } from "@/lib/public-collection";
import { isServerArweaveUploadAvailable, uploadToArweaveServer } from "@/lib/irys-server";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 10 * 1024 * 1024; // 10 MB original
const MAX_INLINE_BYTES = 2.5 * 1024 * 1024;
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

    const contentType = ALLOWED_MIME.has(file.type) ? file.type : mimeFromName(file.name);
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

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/** Store the original file. Prefer Irys; inline only when the original already fits. */
async function persistLogo(
  collectionId: string,
  buf: Buffer,
  contentType: string,
): Promise<string> {
  if (isServerArweaveUploadAvailable()) {
    try {
      return await uploadToArweaveServer(buf, contentType, {
        collectionId,
        skipFund: true,
        requirePosted: true,
      });
    } catch (err) {
      console.error("[logo] Irys upload skipped, storing original inline if small", err);
    }
  }
  if (buf.length > MAX_INLINE_BYTES) {
    throw new Error(
      "Could not store the original logo (permanent storage unavailable and the file is too large to keep inline). Retry in a moment.",
    );
  }
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

function isAllowedImageMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true;
  return false;
}
