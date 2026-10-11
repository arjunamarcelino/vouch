import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server output for containerized hosting — `node server.js` with a minimal traced
  // node_modules. Vercel ignores this and uses its own build.
  output: "standalone",
  // Source-exported workspace packages must be transpiled by Next.
  transpilePackages: ["@vouch/ui", "@vouch/shared"],
  // Don't emit Next's auto-generated AGENTS.md / CLAUDE.md — this repo intentionally keeps none.
  agentRules: false,
};

export default nextConfig;
