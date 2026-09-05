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
  serverExternalPackages: ["sharp", "@irys/upload", "@irys/upload-solana", "yauzl"],
  transpilePackages: [
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-phantom",
    "@solana/wallet-adapter-solflare",
    "@metamask/connect-solana",
  ],

  // Static marketing HTML at / — but never intercept Next.js RSC (?_rsc=) requests.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          missing: [{ type: "query", key: "_rsc" }],
          destination: "/thecrust/index.html",
        },
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
