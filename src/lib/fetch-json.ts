/** Safely parse JSON from a fetch Response — avoids opaque "Unexpected end of JSON input" errors. */
export async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      `Server returned an empty response (HTTP ${res.status}). The request may have timed out — try again.`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Invalid server response (HTTP ${res.status}): ${text.slice(0, 180)}`,
    );
  }
}
