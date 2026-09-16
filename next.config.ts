import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["three"],
  // Next genererer ellers AGENTS.md og CLAUDE.md ved hver `next dev`.
  agentRules: false,
};

export default nextConfig;
