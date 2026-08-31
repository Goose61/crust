import { mkdtemp, rm, unlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import JSZip from "jszip";
import yauzl from "yauzl";

export function isBlobZipUrl(url: string): boolean {
  return url.includes("blob.vercel-storage.com");
}

/** Stream a ZIP to disk — avoids loading large archives into memory. */
export async function downloadZipToTempFile(zipUrl: string): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zip-import-"));
  const tmpPath = path.join(tmpDir, "upload.zip");

  if (isBlobZipUrl(zipUrl)) {
    const { get } = await import("@vercel/blob");
    const result = await get(zipUrl, { access: "public" });
    if (!result?.stream) {
      await rm(tmpDir, { recursive: true, force: true });
      throw new Error("Uploaded ZIP not found in blob storage — try uploading again.");
    }
    const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
    await writeFile(tmpPath, buffer);
    return tmpPath;
  }

  const res = await fetch(zipUrl);
  if (!res.ok) {
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`Could not download uploaded ZIP (HTTP ${res.status})`);
  }
  await writeFile(tmpPath, Buffer.from(await res.arrayBuffer()));
  return tmpPath;
}

export async function cleanupTempZipFile(tmpPath: string): Promise<void> {
  await unlink(tmpPath).catch(() => undefined);
  await rm(path.dirname(tmpPath), { recursive: true, force: true }).catch(() => undefined);
}

export type ZipImageEntry = {
  fileName: string;
};

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) reject(err ?? new Error("Failed to open ZIP archive"));
      else resolve(zipfile);
    });
  });
}

function readEntryBuffer(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error(`Failed to read ${entry.fileName}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

/** List image + JSON paths without extracting the full archive. */
export async function scanZipArchive(zipPath: string): Promise<{
  images: ZipImageEntry[];
  jsonPaths: Set<string>;
}> {
  const zipfile = await openZip(zipPath);
  const images: ZipImageEntry[] = [];
  const jsonPaths = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    zipfile.on("entry", (entry) => {
      const name = entry.fileName.replace(/\\/g, "/");
      if (name.includes("__MACOSX") || /\/$/.test(name)) {
        zipfile.readEntry();
        return;
      }
      if (/\.(png|jpe?g|webp)$/i.test(name)) {
        images.push({ fileName: name });
      } else if (/\.json$/i.test(name)) {
        jsonPaths.add(name);
      }
      zipfile.readEntry();
    });
    zipfile.on("end", () => resolve());
    zipfile.on("error", reject);
    zipfile.readEntry();
  });

  zipfile.close();
  images.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
  return { images, jsonPaths };
}

async function readZipEntryByPath(zipPath: string, targetName: string): Promise<Buffer | null> {
  const zipfile = await openZip(zipPath);
  const normalized = targetName.replace(/\\/g, "/");

  return new Promise((resolve, reject) => {
    zipfile.on("entry", (entry) => {
      const name = entry.fileName.replace(/\\/g, "/");
      if (name !== normalized) {
        zipfile.readEntry();
        return;
      }
      readEntryBuffer(zipfile, entry)
        .then((buf) => {
          zipfile.close();
          resolve(buf);
        })
        .catch(reject);
    });
    zipfile.on("end", () => {
      zipfile.close();
      resolve(null);
    });
    zipfile.on("error", (err) => {
      zipfile.close();
      reject(err);
    });
    zipfile.readEntry();
  });
}

export async function readZipTextEntry(zipPath: string, targetName: string): Promise<string | null> {
  const buf = await readZipEntryByPath(zipPath, targetName);
  return buf ? buf.toString("utf8") : null;
}

/** Read images one at a time — keeps memory flat for large collections. */
export async function readZipImagesSequential(
  zipPath: string,
  images: ZipImageEntry[],
  onImage: (fileName: string, buffer: Buffer, index: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const buffer = await readZipEntryByPath(zipPath, image.fileName);
    if (!buffer) throw new Error(`Missing image in ZIP: ${image.fileName}`);
    await onImage(image.fileName, buffer, i);
  }
}

/** Read full ZIP into memory — used by layer parse (smaller archives). */
export async function loadZipBufferFromImportForm(form: FormData): Promise<Buffer> {
  const zipUrl = String(form.get("zipUrl") || "").trim();
  const file = form.get("file");

  if (zipUrl.startsWith("http")) {
    const tmpPath = await downloadZipToTempFile(zipUrl);
    try {
      const { readFile } = await import("fs/promises");
      return await readFile(tmpPath);
    } finally {
      await cleanupTempZipFile(tmpPath);
    }
  }

  if (!(file instanceof File)) {
    throw new Error("ZIP file required");
  }

  return Buffer.from(await file.arrayBuffer());
}

/** Small direct uploads (≤4 MB) — load into memory with JSZip. */
export async function loadZipFromImportForm(form: FormData): Promise<JSZip> {
  const zipUrl = String(form.get("zipUrl") || "").trim();
  const file = form.get("file");

  if (zipUrl.startsWith("http")) {
    const tmpPath = await downloadZipToTempFile(zipUrl);
    try {
      const { readFile } = await import("fs/promises");
      const buffer = await readFile(tmpPath);
      return JSZip.loadAsync(buffer);
    } finally {
      await cleanupTempZipFile(tmpPath);
    }
  }

  if (!(file instanceof File)) {
    throw new Error("ZIP file required");
  }

  return JSZip.loadAsync(await file.arrayBuffer());
}
