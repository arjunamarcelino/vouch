import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Source-exported workspace packages must be transpiled by Next (plan §17.7-11).
  transpilePackages: ["@vouch/ui", "@vouch/shared"],
};

export default nextConfig;
