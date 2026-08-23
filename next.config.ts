import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "blob.vercel-storage.com" },
      { protocol: "https", hostname: "gateway.irys.xyz" },
      { protocol: "https", hostname: "arweave.net" },
    ],
    // unoptimized: false — let Next.js optimize images (better for Vercel)
  },
  eslint: {
    // Re-enable ESLint during builds so CI catches real issues
    ignoreDuringBuilds: false,
  },
  serverExternalPackages: [
    "sharp",
    "@irys/upload",
    "@irys/upload-solana",
    "@metaplex-foundation/mpl-core",
    "@metaplex-foundation/umi",
    "@metaplex-foundation/umi-bundle-defaults",
    "@metaplex-foundation/umi-rpc-web3js",
    "@metaplex-foundation/umi-serializers",
    "@solana/web3.js",
  ],

  // Serve the static thecrust landing page at the root and legal URLs.
  // beforeFiles rewrites run BEFORE Next.js matches any pages or static files,
  // so they take priority over src/app/page.tsx at "/".
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/thecrust/index.html" },
        { source: "/contact", destination: "/thecrust/contact.html" },
        { source: "/terms", destination: "/thecrust/terms.html" },
        { source: "/privacy", destination: "/thecrust/privacy.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
