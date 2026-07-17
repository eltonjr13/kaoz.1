import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop build embeds Next's self-contained production server.
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
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
