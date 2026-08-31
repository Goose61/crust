import { NextRequest, NextResponse } from "next/server";
import { newId, saveCollection, slugify } from "@/lib/store";
import { parseLayerZip, persistLayerFiles } from "@/lib/compositor";
import { rateLimit } from "@/lib/rate-limit";
import { defaultPayments, type Collection } from "@/lib/types";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit(`layers:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Upload too large (max 100 MB)" }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ZIP file required" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Upload too large (max 100 MB)" }, { status: 413 });
  }

  const name = String(form.get("name") || "Untitled collection");
  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseLayerZip(buffer);
  if (parsed.layers.length === 0) {
    return NextResponse.json(
      { error: "No trait folders found. Put PNGs in folders like Background/Blue.png" },
      { status: 400 },
    );
  }
  const id = newId();
  // persistLayerFiles now uploads to Blob and returns updated layers with blobUrls
  const layers = await persistLayerFiles(id, parsed.files);

  const collection: Collection = {
    id,
    slug: slugify(name),
    name,
    symbol: name.slice(0, 6).toUpperCase().replace(/\s/g, ""),
    description: "",
    nameTemplate: "{name} #{id}",
    chain: "solana",
    status: "draft",
    supply: 100,
    mintedCount: 0,
    artPath: "path-b",
    stackOrder: parsed.stackOrder,
    layers,
    blindMint: true,
    revealTrigger: "staggered",
    revealAtPercent: 50,
    revealed: false,
    milestones: [
      { at: 25, events: ["unlock_holder_page", "enable_gift_mint"] },
      { at: 50, events: ["reveal_batch", "enable_secondary", "featured_homepage"] },
      { at: 100, events: ["reveal_all", "snapshot_holders"] },
    ],
    payments: defaultPayments(),
    fees: {
      ownerPercent: 98,
      holdersPercent: 1,
      buybackPercent: 1,
      locked: false,
    },
    allowlist: [],
    waitlist: [],
    publicMintOpen: true,
    secondaryEnabled: false,
    holderPageUnlocked: false,
    irysPublished: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tokens: [],
  };
  await saveCollection(collection);
  return NextResponse.json({
    collection,
    traitCount: layers.length,
    fileCount: parsed.files.length,
  });
}
