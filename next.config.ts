import type { NextConfig } from "next";
import { hstsHeader, SECURITY_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  experimental: {
    // Windows OOM: Next otherwise spawns ~CPU-count page-data workers.
    cpus: 1,
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 50,
  },
  async headers() {
    const headers = [...SECURITY_HEADERS];
    const hsts = hstsHeader();
    if (hsts) headers.push(hsts);
    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;
