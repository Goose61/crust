/** Match image entries to sidecar JSON paths inside a ZIP. */

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function basename(p: string): string {
  const n = normPath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

function stemFromImage(entryPath: string): string {
  return basename(entryPath).replace(/\.(png|jpe?g|webp)$/i, "");
}

function stemFromJson(jsonPath: string): string {
  return basename(jsonPath).replace(/\.json$/i, "");
}

/** Same numeric id with any zero-padding (1 ↔ 001 ↔ 0001). */
function numericStemMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
  return parseInt(a, 10) === parseInt(b, 10);
}

function padVariants(n: number): string[] {
  const raw = String(n);
  return [raw, raw.padStart(3, "0"), raw.padStart(4, "0")];
}

/** Skip aggregate / tooling JSON files that are not per-token sidecars. */
export function isTokenSidecarJsonPath(path: string): boolean {
  const stem = stemFromJson(path).toLowerCase();
  if (!stem) return false;
  if (stem === "_metadata" || stem === "metadata" || stem === "collection") return false;
  if (stem.endsWith("-metadata") || stem.endsWith("_metadata")) return false;
  return true;
}

/** Detect 0-based (0..N-1) vs 1-based (1..N) numeric JSON naming. */
export function inferJsonIndexBase(
  jsonPaths: Iterable<string>,
  tokenCount: number,
): 0 | 1 {
  const stems = [...jsonPaths]
    .map(stemFromJson)
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10));
  if (stems.length === 0) return 1;
  const min = Math.min(...stems);
  const max = Math.max(...stems);
  if (min === 0 && (max === tokenCount - 1 || max === tokenCount)) return 0;
  if (min === 1 && max === tokenCount) return 1;
  if (min === 0) return 0;
  return 1;
}

function parallelMetadataCandidates(entryPath: string): string[] {
  const norm = normPath(entryPath);
  const out = new Set<string>();
  out.add(norm.replace(/\.(png|jpe?g|webp)$/i, ".json"));
  out.add(norm.replace(/\/images\//i, "/metadata/").replace(/\.(png|jpe?g|webp)$/i, ".json"));
  out.add(norm.replace(/\/img\//i, "/metadata/").replace(/\.(png|jpe?g|webp)$/i, ".json"));
  return [...out];
}

function preferredNumericStems(
  tokenId: number,
  imageStem: string,
  indexBase: 0 | 1,
): string[] {
  const out = new Set<string>();
  const zeroIndexed = indexBase === 0 ? tokenId - 1 : tokenId;
  const oneIndexed = indexBase === 1 ? tokenId : tokenId + 1;

  for (const n of [zeroIndexed, oneIndexed, tokenId]) {
    if (n >= 0) padVariants(n).forEach((v) => out.add(v));
  }
  if (/^\d+$/.test(imageStem)) {
    padVariants(parseInt(imageStem, 10)).forEach((v) => out.add(v));
  }
  out.add(imageStem);
  return [...out];
}

export function findSidecarPath(
  entryPath: string,
  tokenId: number,
  jsonPaths: Set<string> | Iterable<string>,
  options?: { tokenCount?: number; indexBase?: 0 | 1 },
): string | undefined {
  const paths = jsonPaths instanceof Set ? [...jsonPaths] : [...jsonPaths];
  const pathSet = new Set(paths);
  const tokenCount = options?.tokenCount ?? tokenId;
  const indexBase =
    options?.indexBase ?? inferJsonIndexBase(paths, tokenCount);

  for (const candidate of parallelMetadataCandidates(entryPath)) {
    if (pathSet.has(candidate)) return candidate;
  }

  const imageStem = stemFromImage(entryPath);
  const preferredStems = preferredNumericStems(tokenId, imageStem, indexBase);

  for (const stem of preferredStems) {
    for (const jsonPath of paths) {
      if (numericStemMatches(stemFromJson(jsonPath), stem)) return jsonPath;
    }
  }

  const suffixes = preferredStems.flatMap((c) => [
    `${c}.json`,
    `metadata/${c}.json`,
    `json/${c}.json`,
  ]);
  for (const jsonPath of paths) {
    const norm = normPath(jsonPath);
    if (suffixes.some((suffix) => norm === suffix || norm.endsWith(`/${suffix}`))) {
      return jsonPath;
    }
  }

  return undefined;
}
