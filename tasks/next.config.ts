import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives in a sub-folder of the SS-FAMILY repo; keep Next from
  // treating the repo root (which has its own lockfile) as the workspace.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
