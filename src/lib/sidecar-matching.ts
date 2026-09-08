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

function stemCandidates(tokenId: number, imageStem: string): string[] {
  const out = new Set<string>();
  out.add(imageStem);
  out.add(String(tokenId));
  out.add(String(tokenId).padStart(3, "0"));
  out.add(String(tokenId).padStart(4, "0"));
  if (tokenId > 0) {
    const zero = tokenId - 1;
    out.add(String(zero));
    out.add(String(zero).padStart(3, "0"));
    out.add(String(zero).padStart(4, "0"));
  }
  if (/^\d+$/.test(imageStem)) {
    const n = parseInt(imageStem, 10);
    out.add(String(n));
    out.add(String(n).padStart(3, "0"));
    out.add(String(n).padStart(4, "0"));
  }
  return [...out];
}

/** Skip aggregate / tooling JSON files that are not per-token sidecars. */
export function isTokenSidecarJsonPath(path: string): boolean {
  const stem = stemFromJson(path).toLowerCase();
  if (!stem) return false;
  if (stem === "_metadata" || stem === "metadata" || stem === "collection") return false;
  if (stem.endsWith("-metadata") || stem.endsWith("_metadata")) return false;
  return true;
}

export function findSidecarPath(
  entryPath: string,
  tokenId: number,
  jsonPaths: Set<string> | Iterable<string>,
): string | undefined {
  const paths = jsonPaths instanceof Set ? [...jsonPaths] : [...jsonPaths];
  const imageDir = normPath(entryPath).includes("/")
    ? normPath(entryPath).slice(0, normPath(entryPath).lastIndexOf("/") + 1)
    : "";

  const nextToImage = entryPath.replace(/\.(png|jpe?g|webp)$/i, ".json");
  if (paths.includes(nextToImage)) return nextToImage;

  const imageStem = stemFromImage(entryPath);
  const candidates = stemCandidates(tokenId, imageStem);

  for (const jsonPath of paths) {
    const jsonStem = stemFromJson(jsonPath);
    if (candidates.some((c) => numericStemMatches(c, jsonStem))) {
      return jsonPath;
    }
  }

  const suffixes = candidates.flatMap((c) => [
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

  if (imageDir) {
    for (const jsonPath of paths) {
      const norm = normPath(jsonPath);
      if (!norm.startsWith(imageDir)) continue;
      const jsonStem = stemFromJson(jsonPath);
      if (numericStemMatches(imageStem, jsonStem)) return jsonPath;
    }
  }

  return undefined;
}
