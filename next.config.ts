import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Loaded at runtime from node_modules so the SDK's own dependencies are traced intact.
  serverExternalPackages: ["@vercel/sandbox"],
};

export default nextConfig;
