import JSZip from "jszip";
import { isBlobStorageUrl } from "./blob-config";
import { downloadBlobToTmp } from "./blob-storage";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";

export async function loadZipBufferFromImportForm(form: FormData): Promise<Buffer> {
  const zipUrl = String(form.get("zipUrl") || "").trim();
  const file = form.get("file");

  if (zipUrl.startsWith("http") || zipUrl.startsWith("/api/blob/file/") || isBlobStorageUrl(zipUrl)) {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zip-import-"));
    const tmpPath = path.join(tmpDir, "upload.zip");
    try {
      await downloadBlobToTmp(zipUrl, tmpPath);
      return await readFile(tmpPath);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  if (!(file instanceof File)) {
    throw new Error("ZIP file required");
  }

  return Buffer.from(await file.arrayBuffer());
}

export async function loadZipFromImportForm(form: FormData): Promise<JSZip> {
  const buffer = await loadZipBufferFromImportForm(form);
  return JSZip.loadAsync(buffer);
}
