/**
 * Ensures sharp native bindings are present for the current platform (Vercel linux-x64).
 * Safe no-op when sharp already loads.
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function sharpLoads() {
  try {
    require("sharp");
    return true;
  } catch {
    return false;
  }
}

if (!sharpLoads()) {
  console.log("[postinstall] sharp missing — rebuilding optional native bindings…");
  execSync("npm rebuild sharp --include=optional", { stdio: "inherit" });
}

if (!sharpLoads()) {
  console.warn("[postinstall] sharp still unavailable after rebuild (image routes may fail)");
}
