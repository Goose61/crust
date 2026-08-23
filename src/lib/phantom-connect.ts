/** Phantom browse deeplink — opens this page inside Phantom's in-app browser. */
export function buildPhantomBrowseUrl(pageUrl: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `https://phantom.app/ul/browse/${encodeURIComponent(pageUrl)}?ref=${encodeURIComponent(origin)}`;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export const PHANTOM_EXTENSION_URL =
  "https://chrome.google.com/webstore/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa";

export const PHANTOM_DOWNLOAD_URL = "https://phantom.app/download";
