import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { newId, saveCollection, slugify } from "@/lib/store";
import { assignRarityRanks } from "@/lib/compositor";
import { uploadBlob, uploadBlobText } from "@/lib/blob-storage";
import { blobImagePath, blobMetadataPath } from "@/lib/paths";
import { rateLimit } from "@/lib/rate-limit";
import { buildTokenMetadataJson } from "@/lib/metadata-builders";
import { loadZipFromImportForm } from "@/lib/import-zip-server";
import { defaultPayments, type Collection, type GeneratedToken } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const DEFAULT_ROYALTY_BPS = 500;

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
    const zip = await loadZipFromImportForm(form);
    const id = newId();

    const imageEntries = Object.entries(zip.files)
      .filter(([p, e]) => !e.dir && /\.(png|jpe?g|webp)$/i.test(p) && !p.includes("__MACOSX"))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    if (imageEntries.length === 0) {
      return NextResponse.json({ error: "No images found in ZIP" }, { status: 400 });
    }

    const tokens: GeneratedToken[] = [];
    let i = 1;
    for (const [entryPath, entry] of imageEntries) {
      const buf = Buffer.from(await entry.async("uint8array"));
      const ext = path.extname(entryPath) || ".png";
      const safeExt = ext === ".jpg" ? ".jpeg" : ext;
      const imageUri = await uploadBlob(
        blobImagePath(id, i),
        buf,
        safeExt === ".png" ? "image/png" : "image/jpeg",
      );

      const jsonName = entryPath.replace(/\.(png|jpe?g|webp)$/i, ".json");
      const jsonFile = zip.file(jsonName) ?? zip.file(`metadata/${i}.json`);
      let attributes: GeneratedToken["attributes"] = [];
      if (jsonFile) {
        try {
          const meta = JSON.parse(await jsonFile.async("string"));
          attributes = meta.attributes ?? [];
        } catch {
          attributes = [];
        }
      }
      tokens.push({
        tokenId: i,
        dna: attributes.map((a) => String(a.value)).join("|"),
        attributes,
        imageRelPath: `images/${i}${safeExt}`,
        metadataRelPath: `metadata/${i}.json`,
        imageUri,
      });
      i += 1;
    }

    const ranked = assignRarityRanks(tokens);
    for (const token of ranked) {
      const metaJson = JSON.stringify(
        buildTokenMetadataJson({
          name: `${name} #${token.tokenId}`,
          symbol: name.slice(0, 8).toUpperCase(),
          description,
          sellerFeeBps: DEFAULT_ROYALTY_BPS,
          image: token.imageUri ?? token.imageRelPath,
          attributes: token.attributes,
          creatorWallet,
        }),
        null,
        2,
      );
      token.metadataUri = await uploadBlobText(blobMetadataPath(id, token.tokenId), metaJson);
    }

    const collection: Collection = {
      id,
      slug: slugify(name),
      name,
      symbol: name.slice(0, 6).toUpperCase().replace(/\s/g, ""),
      description,
      nameTemplate: "{name} #{id}",
      chain: "solana",
      status: "draft",
      supply: ranked.length,
      mintedCount: 0,
      artPath: "path-a",
      stackOrder: [],
      layers: [],
      blindMint: false,
      revealTrigger: "manual",
      revealed: true,
      royaltyBps: DEFAULT_ROYALTY_BPS,
      milestones: [{ at: 100, events: ["enable_secondary", "snapshot_holders"] }],
      payments: defaultPayments({ giftMintEnabled: true, creatorWallet }),
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
      tokens: ranked,
    };
    await saveCollection(collection);
    return NextResponse.json({ collection });
  } catch (err) {
    console.error("[POST /api/import/images]", err);
    const message = err instanceof Error ? err.message : "Import failed";
    const status = message.includes("MONGODB") || message.includes("connect") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
