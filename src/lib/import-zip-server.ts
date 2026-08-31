import JSZip from "jszip";

export async function loadZipBufferFromImportForm(form: FormData): Promise<Buffer> {
  const zipUrl = String(form.get("zipUrl") || "").trim();
  const file = form.get("file");

  if (zipUrl.startsWith("http")) {
    const res = await fetch(zipUrl);
    if (!res.ok) {
      throw new Error(`Could not download uploaded ZIP (HTTP ${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
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
