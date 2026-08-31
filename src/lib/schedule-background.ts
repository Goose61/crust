import { waitUntil } from "@vercel/functions";
import { after } from "next/server";

/** Run work after the response without crashing if scheduling APIs are unavailable. */
export function scheduleBackground(task: () => Promise<void>): void {
  const work = task().catch((err) => {
    console.error("[background task]", err);
  });

  try {
    waitUntil(work);
    return;
  } catch {
    // waitUntil throws off-Vercel in some environments.
  }

  try {
    after(() => work);
  } catch (err) {
    console.warn("[background task] after() unavailable, running best-effort", err);
    void work;
  }
}
