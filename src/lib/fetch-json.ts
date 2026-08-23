/** Parse JSON from a fetch Response; surface empty/HTML bodies as readable errors. */
export async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Server returned empty response (${res.status}). Check Vercel logs.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      text.startsWith("<")
        ? `Server error (${res.status}). The mint API may have crashed — check Vercel logs.`
        : `Invalid server response (${res.status}): ${text.slice(0, 160)}`,
    );
  }
}
