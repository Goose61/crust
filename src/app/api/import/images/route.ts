import { NextRequest, NextResponse } from "next/server";
import { newId, saveCollection } from "@/lib/store";
import { rateLimit } from "@/lib/rate-limit";
import { buildImportingCollectionStub } from "@/lib/import-collection-stub";
import type { Collection } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({ ok: true, mode: "import-images" });
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
    const rl = await rateLimit(`import:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const form = await req.formData();
    const zipUrl = String(form.get("zipUrl") || "").trim();
    const file = form.get("file");
    const declaredSize = Number(form.get("fileSize") || 0);
    const uploadBytes =
      file instanceof File ? file.size : zipUrl ? declaredSize : 0;

    if (!zipUrl && !(file instanceof File)) {
      return NextResponse.json({ error: "ZIP of images required" }, { status: 400 });
    }
    if (uploadBytes > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Upload too large (max 500 MB)" }, { status: 413 });
    }

    const name = String(form.get("name") || "Imported collection");
    const description = String(form.get("description") || "");
    const creatorWallet = String(form.get("creatorWallet") || "");

    // Blob ZIP: save a lightweight stub — processing runs in /api/import/images/process.
    if (zipUrl) {
      const id = newId();
      const stub = buildImportingCollectionStub({
        id,
        name,
        description,
        creatorWallet,
        pendingZipUrl: zipUrl,
      });
      await saveCollection(stub);

      return NextResponse.json({
        collection: stub,
        importing: true,
      } satisfies { collection: Collection; importing: true });
    }

    const { importImagesFromZipSync } = await import("@/lib/import-images-job");
    const collection = await importImagesFromZipSync(form);
    return NextResponse.json({ collection });
  } catch (err) {
    console.error("[POST /api/import/images]", err);
    const message = err instanceof Error ? err.message : "Import failed";
    const status =
      message.includes("Mongo") || message.includes("connect") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
