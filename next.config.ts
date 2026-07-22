import type { NextConfig } from "next";

const desktopTraceExcludes = [
  "./.agents/**/*",
  "./.codex/**/*",
  "./.generated/**/*",
  "./.git/**/*",
  "./.github/**/*",
  "./.hermes/**/*",
  "./.next/**/*",
  "./.pnpm-store/**/*",
  "./build/**/*",
  "./cache/**/*",
  "./dist/**/*",
  "./docs/**/*",
  "./electron/**/*",
  "./notebooks/**/*",
  "./output/**/*",
  "./public/uploads/**/*",
  "./python/**/*",
  "./release/**/*",
  "./scratch/**/*",
  "./scripts/**/*",
  "./skills/**/*",
  "./storage/**/*",
  "./tests/**/*",
  "./tmp/**/*"
];

const nextConfig: NextConfig = {
  // The desktop build embeds Next's self-contained production server.
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  // Next uses these filters directly on non-Windows builds. The build wrapper
  // also prunes runtime data because Next 16.2.6 does not normalize glob paths
  // before matching them on Windows.
  outputFileTracingExcludes: {
    "next-server": desktopTraceExcludes,
    "/*": desktopTraceExcludes
  },
  allowedDevOrigins: [
    "192.169.0.101",
    "192.169.0.101:3000",
    "192.169.0.104",
    "192.169.0.104:3000",
    "localhost:3000"
  ],
  serverExternalPackages: ["@modelcontextprotocol/sdk", "cross-spawn", "sharp"],
  logging: {
    incomingRequests: {
      ignore: [
        /^\/api\/flow\/extension/
      ]
    }
  }
};

export default nextConfig;
