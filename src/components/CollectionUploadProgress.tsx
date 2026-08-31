"use client";

export type CollectionUploadPhase = "uploading" | "processing";

export type CollectionUploadProgressState = {
  fileName: string;
  fileSize: number;
  phase: CollectionUploadPhase;
  percent: number;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CollectionUploadProgressOverlay({
  fileName,
  fileSize,
  phase,
  percent,
}: CollectionUploadProgressState) {
  const clamped = Math.max(0, Math.min(100, percent));
  const phaseLabel =
    phase === "uploading"
      ? "Uploading ZIP to storage…"
      : "Processing images & writing metadata…";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-progress-title"
      aria-busy="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#141414] p-6 shadow-2xl">
        <p
          id="upload-progress-title"
          className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.18em] text-primary uppercase"
        >
          Importing collection
        </p>
        <h2 className="mt-2 truncate text-lg font-semibold text-white" title={fileName}>
          {fileName}
        </h2>
        <p className="mt-1 text-sm text-white/50">{formatBytes(fileSize)}</p>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs text-white/60">
            <span>{phaseLabel}</span>
            <span className="font-mono tabular-nums">{clamped}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${clamped}%` }}
            />
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-white/40">
          {phase === "uploading"
            ? "Large ZIPs upload directly to storage first — keep this tab open until processing starts."
            : "Almost done. We are extracting images, uploading to blob storage, and creating your collection draft."}
        </p>
      </div>
    </div>
  );
}
