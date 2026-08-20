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

  // Redirect /api/assets-blob in production since Blob URLs are direct CDN links
  // (The route still exists as a local-dev fallback)
};

export default nextConfig;
