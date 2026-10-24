import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "rss-parser", "jsdom"],
  poweredByHeader: false,
  // The post image cards read their font from disk at request time.
  outputFileTracingIncludes: { "/api/cards/[id]": ["./assets/fonts/**"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
