import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Shared server: keep static generation inside the reviewed build budget.
  experimental: { cpus: 2 },
  // Runtime filesystem access in graph-layout-store.ts cannot be statically
  // traced. Next warns that this can include the app project in standalone
  // output, which may increase image size. The Docker builder receives only
  // package files, src/, public/ and build config; runtime data/auth stay out
  // of the image and are mounted separately. This container build accepts the
  // trace warning; verify artifact contents and size after a successful build.
};

export default nextConfig;
