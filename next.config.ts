import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the trace root to this project. Without it, Next walks up the directory
  // tree looking for a lockfile and can settle on a parent directory, which
  // quietly pulls unrelated files into the deployment bundle.
  outputFileTracingRoot: path.resolve(process.cwd()),

  // The Neo4j driver opens raw TCP sockets and is server-only. Listing it here
  // keeps it out of the bundler entirely and loads it from node_modules at
  // runtime, which is what it expects.
  serverExternalPackages: ["neo4j-driver"],

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
