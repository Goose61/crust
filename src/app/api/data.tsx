export const footerlabels: { label: string; herf: string }[] = [
  { label: "Launch", herf: "/launch" },
  { label: "Dashboard", herf: "/dashboard" },
  { label: "Market", herf: "/market" },
  { label: "Market", herf: "/market" },
];

export const featuredGridNfts = [
  "/images/collection/120.jpeg",
  "/images/collection/173.jpeg",
  "/images/collection/117.jpeg",
  "/images/collection/282.jpeg",
];

export const featuredCarouselNfts = [
  { id: 347, src: "/images/collection/347.jpeg" },
  { id: 236, src: "/images/collection/236.jpeg" },
  { id: 476, src: "/images/collection/476.jpeg" },
  { id: 535, src: "/images/collection/535.jpeg" },
  { id: 595, src: "/images/collection/595.jpeg" },
  { id: 345, src: "/images/collection/345.jpeg" },
];

export const pricedata: {
  title: string;
  short: string;
  icon: string;
  background: string;
  price: string;
  mark: string;
  width: number;
  height: number;
  padding: string;
}[] = featuredCarouselNfts.map((nft) => ({
  title: `Dough Boi #${nft.id}`,
  short: "PFP",
  icon: nft.src,
  background: "bg-white/5",
  price: "Collection",
  mark: "Solana",
  width: 280,
  height: 280,
  padding: "p-0",
}));

export const portfolioData: { image: string; title: string }[] = [
  {
    image: "/images/portfolio/portfolio-icon-1.svg",
    title: "Launch without writing JSON",
  },
  {
    image: "/images/portfolio/portfolio-icon-2.svg",
    title: "Pay in SOL, USDC, or any SPL",
  },
  {
    image: "/images/portfolio/portfolio-icon-3.svg",
    title: "Stay listed here after sell-out",
  },
];

export const upgradeData: { title: string }[] = [
  { title: "Permanent on-chain storage" },
  { title: "Blind mint + timed reveal" },
  { title: "Gift mint to any wallet" },
  { title: "SOL / USDC / SPL at spot USD" },
  { title: "SlicePay hosted checkout" },
  { title: "In-ecosystem secondary market" },
  { title: "Locked creator fee splits" },
  { title: "Layer compositor + rarity ranks" },
];

export const perksData: {
  icon: string;
  title: string;
  text: string;
  space: string;
}[] = [
  {
    icon: "/images/perks/peak-icon-1.svg",
    title: "Creator dashboard",
    text: "Reveal, milestones, allowlists, and mint progress in one place.",
    space: "lg:mt-8",
  },
  {
    icon: "/images/perks/peak-icon-2.svg",
    title: "Holder lounge",
    text: "Unlock a collection page, sequel allowlists, and snapshots at mint %.",
    space: "lg:mt-14",
  },
  {
    icon: "/images/perks/peak-icon-3.svg",
    title: "Native market",
    text: "Secondary listings open on this marketplace, not on a third-party site.",
    space: "lg:mt-4",
  },
];

export const timelineData: {
  icon: string;
  title: string;
  text: string;
  position: string;
}[] = [
  {
    icon: "/images/timeline/icon-planning.svg",
    title: "Layers",
    text: "Upload trait folders. We composite and write metadata.",
    position: "md:top-0 md:left-0",
  },
  {
    icon: "/images/timeline/icon-refinement.svg",
    title: "Rarity",
    text: "Sliders set trait odds. Ranks compute after generate.",
    position: "md:top-0 md:right-0",
  },
  {
    icon: "/images/timeline/icon-prototype.svg",
    title: "Mint",
    text: "Go live on Solana. Collectors pay SOL, USDC, or SPL at spot.",
    position: "md:bottom-0 md:left-0",
  },
  {
    icon: "/images/timeline/icon-support.svg",
    title: "Trade",
    text: "Milestones unlock the holder lounge and secondary market.",
    position: "md:bottom-0 md:right-0",
  },
];

export const CryptoData: { name: string; price: number }[] = [
  { name: "Bitcoin BTC/USD", price: 67646.84 },
  { name: "Ethereum ETH/USD", price: 2515.93 },
  { name: "Bitcoin Cash BTC/USD", price: 366.96 },
  { name: "Litecoin LTC/USD", price: 61504.54 },
];
