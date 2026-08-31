import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { mkdtemp, rm, unlink } from "fs/promises";
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

  async function streamToFile(body: ReadableStream<Uint8Array> | NodeJS.ReadableStream) {
    const nodeStream =
      body instanceof Readable
        ? body
        : Readable.fromWeb(body as unknown as import("stream/web").ReadableStream);
    await pipeline(nodeStream, createWriteStream(tmpPath));
  }

  try {
    if (isBlobZipUrl(zipUrl)) {
      const { get } = await import("@vercel/blob");
      const result = await get(zipUrl, { access: "public" });
      if (!result?.stream) {
        throw new Error("Uploaded ZIP not found in blob storage — try uploading again.");
      }
      await streamToFile(result.stream);
      return tmpPath;
    }

    const res = await fetch(zipUrl);
    if (!res.ok) {
      throw new Error(`Could not download uploaded ZIP (HTTP ${res.status})`);
    }
    if (!res.body) {
      throw new Error("Could not download uploaded ZIP (empty response body)");
    }
    await streamToFile(res.body);
    return tmpPath;
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true });
    throw err;
  }
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

/** Read images one at a time — single ZIP pass, flat memory for large collections. */
export async function readZipImagesSequential(
  zipPath: string,
  images: ZipImageEntry[],
  onImage: (fileName: string, buffer: Buffer, index: number) => Promise<void>,
): Promise<void> {
  const wanted = new Map(
    images.map((entry, index) => [entry.fileName.replace(/\\/g, "/"), index]),
  );
  let remaining = images.length;
  const zipfile = await openZip(zipPath);

  await new Promise<void>((resolve, reject) => {
    const readNext = () => {
      zipfile.readEntry();
    };

    zipfile.on("entry", (entry) => {
      const name = entry.fileName.replace(/\\/g, "/");
      const index = wanted.get(name);
      if (index === undefined) {
        readNext();
        return;
      }

      readEntryBuffer(zipfile, entry)
        .then(async (buffer) => {
          await onImage(name, buffer, index);
          remaining -= 1;
          if (remaining === 0) {
            zipfile.close();
            resolve();
            return;
          }
          readNext();
        })
        .catch((err) => {
          zipfile.close();
          reject(err);
        });
    });

    zipfile.on("end", () => {
      zipfile.close();
      if (remaining > 0) {
        reject(new Error(`Missing ${remaining} image(s) in ZIP`));
      } else {
        resolve();
      }
    });

    zipfile.on("error", (err) => {
      zipfile.close();
      reject(err);
    });

    readNext();
  });
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
