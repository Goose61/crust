export type WalletOptionId = "phantom" | "solflare" | "backpack" | "metamask";

export type WalletOption = {
  id: WalletOptionId;
  name: string;
  /** Adapter / Wallet Standard names that map to this option. */
  adapterNames: string[];
  installUrl: string;
  /** Shown when the adapter icon is not available. */
  accent: string;
};

export const WALLET_OPTIONS: WalletOption[] = [
  {
    id: "phantom",
    name: "Phantom",
    adapterNames: ["Phantom"],
    installUrl: "https://phantom.app/download",
    accent: "#AB9FF2",
  },
  {
    id: "solflare",
    name: "Solflare",
    adapterNames: ["Solflare"],
    installUrl: "https://solflare.com/download",
    accent: "#FC7227",
  },
  {
    id: "backpack",
    name: "Backpack",
    adapterNames: ["Backpack"],
    installUrl: "https://backpack.app/download",
    accent: "#E33E3F",
  },
  {
    id: "metamask",
    name: "MetaMask",
    adapterNames: ["MetaMask", "MetaMask Flask"],
    installUrl: "https://metamask.io/download",
    accent: "#F6851B",
  },
];

/** @deprecated Use WALLET_OPTIONS */
export const DESKTOP_WALLET_OPTIONS = WALLET_OPTIONS;

function pageAndRef(pageUrl: string): { encodedPage: string; encodedRef: string } {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return {
    encodedPage: encodeURIComponent(pageUrl),
    encodedRef: encodeURIComponent(origin || pageUrl),
  };
}

/** Opens this page in Phantom's in-app browser. */
export function buildPhantomBrowseUrl(pageUrl: string): string {
  const { encodedPage, encodedRef } = pageAndRef(pageUrl);
  return `https://phantom.app/ul/browse/${encodedPage}?ref=${encodedRef}`;
}

/** @see https://docs.solflare.com/solflare/technical/deeplinks/other-methods/browse */
export function buildSolflareBrowseUrl(pageUrl: string): string {
  const { encodedPage, encodedRef } = pageAndRef(pageUrl);
  return `https://solflare.com/ul/v1/browse/${encodedPage}?ref=${encodedRef}`;
}

/** @see https://docs.backpack.app/deeplinks/other-methods/browse */
export function buildBackpackBrowseUrl(pageUrl: string): string {
  const { encodedPage, encodedRef } = pageAndRef(pageUrl);
  return `https://backpack.app/ul/v1/browse/${encodedPage}?ref=${encodedRef}`;
}

/** @see https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks/ */
export function buildMetaMaskBrowseUrl(pageUrl: string): string {
  const stripped = pageUrl.replace(/^https?:\/\//, "");
  return `https://link.metamask.io/dapp/${stripped}`;
}

export function buildWalletBrowseUrl(id: WalletOptionId, pageUrl: string): string {
  switch (id) {
    case "solflare":
      return buildSolflareBrowseUrl(pageUrl);
    case "backpack":
      return buildBackpackBrowseUrl(pageUrl);
    case "metamask":
      return buildMetaMaskBrowseUrl(pageUrl);
    default:
      return buildPhantomBrowseUrl(pageUrl);
  }
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
