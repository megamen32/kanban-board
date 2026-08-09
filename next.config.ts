import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // The kanban app reads/writes files under TASKS_DIR at runtime. The
  // dynamic filesystem access in src/lib/kanban/file-store.ts triggers
  // Next's static-tracing warning, which is informational here because
  // we deploy as a self-contained container, not a serverless output.
  // Build remains clean; the warning is intentionally not treated as
  // an error.
};

export default nextConfig;
