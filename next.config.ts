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
  serverExternalPackages: ["sharp", "@irys/upload", "@irys/upload-solana"],

  // Serve the static thecrust landing page at the root and legal URLs.
  // Rewrites run before the App Router so the static HTML is returned directly
  // without the Next.js layout wrapper (which is intentional — the landing has
  // its own chrome).
  async rewrites() {
    return [
      { source: "/", destination: "/thecrust/index.html" },
      { source: "/contact", destination: "/thecrust/contact.html" },
      { source: "/terms", destination: "/thecrust/terms.html" },
      { source: "/privacy", destination: "/thecrust/privacy.html" },
    ];
  },
};

export default nextConfig;
