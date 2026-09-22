import type { NextConfig } from "next";
import { hstsHeader, SECURITY_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  experimental:
    process.platform === "win32"
      ? {
          // Windows OOM: Next otherwise spawns ~CPU-count page-data workers.
          cpus: 1,
          staticGenerationMaxConcurrency: 1,
          staticGenerationMinPagesPerWorker: 50,
        }
      : undefined,
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
