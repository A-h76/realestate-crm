import type { NextConfig } from "next";
import { hstsHeader, SECURITY_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  experimental: {
    // Proxy buffers request bodies; bound that buffer (explicit Content-Length is capped in src/proxy.ts).
    proxyClientMaxBodySize: "2mb",
    ...(process.platform === "win32"
      ? {
          // Windows OOM: Next otherwise spawns ~CPU-count page-data workers.
          cpus: 1,
          staticGenerationMaxConcurrency: 1,
          staticGenerationMinPagesPerWorker: 50,
        }
      : {}),
  },
  async redirects() {
    // Client-facing route renames; old bookmarks keep working.
    return [
      { source: "/whatsapp", destination: "/conversations", permanent: true },
      { source: "/golden-path", destination: "/lead-journey", permanent: true },
    ];
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
