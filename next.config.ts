import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.169.0.101",
    "192.169.0.101:3000",
    "192.169.0.104",
    "192.169.0.104:3000",
    "localhost:3000"
  ],
  logging: {
    incomingRequests: {
      ignore: [
        /^\/api\/flow\/extension/
      ]
    }
  }
};

export default nextConfig;

