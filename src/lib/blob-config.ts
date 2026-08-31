export const ZIP_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
];

export function getBlobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || undefined;
}
