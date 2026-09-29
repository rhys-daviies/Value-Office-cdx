import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this repository (an unrelated lockfile exists higher up on some machines).
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
