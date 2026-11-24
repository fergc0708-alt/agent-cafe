import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next ignores app/ folders that start with a dot, so /.well-known/* is served from /well-known/*.
  async rewrites() {
    return [{ source: "/.well-known/:path*", destination: "/well-known/:path*" }];
  },
  poweredByHeader: false,
};

export default nextConfig;
