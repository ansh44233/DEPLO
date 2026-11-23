import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Loaded at runtime from node_modules so the SDK's own dependencies are traced intact.
  serverExternalPackages: ["@vercel/sandbox"],
  // The Rust BLAKE3 hasher is read from disk at runtime (lib/deploy/blake3-wasm.ts).
  outputFileTracingIncludes: {
    "/api/**": ["./lib/deploy/blake3.wasm"],
  },
};

export default nextConfig;
