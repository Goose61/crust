import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getCollection, saveCollection } from "@/lib/store";
import { uploadBlob } from "@/lib/blob-storage";
import { blobLogoPath } from "@/lib/paths";
import { readAuthHeaders, assertCreatorAuth } from "@/lib/wallet-auth";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const collection = await getCollection(id);
  if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });

  const auth = readAuthHeaders(req);
  try {
    assertCreatorAuth(auth, collection.payments.creatorWallet, {
      allowUnsetCreator: !collection.payments.creatorWallet,
    });
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

  // Validate MIME type (client-supplied but used only for Content-Type header)
  const ext = (path.extname(file.name) || ".png").toLowerCase();
  const safeExt = ext === ".jpg" ? ".jpeg" : ext;
  const contentType = ALLOWED_MIME.has(file.type) ? file.type : "image/png";

  const buf = Buffer.from(await file.arrayBuffer());

  // Magic byte check for PNG, JPEG, WebP
  if (!isAllowedImageMagic(buf)) {
    return NextResponse.json({ error: "Invalid image file" }, { status: 400 });
  }

  const logoUrl = await uploadBlob(blobLogoPath(id, safeExt), buf, contentType);
  const updated = await saveCollection({ ...collection, logoUrl });
  return NextResponse.json({ logoUrl, collection: updated });
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
