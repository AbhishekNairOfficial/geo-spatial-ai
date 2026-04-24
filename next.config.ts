import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["react-map-gl"],
  // Avoid picking a parent `package-lock.json` as the app root (Next 16 + Turbopack).
  turbopack: { root: projectRoot },
};

export default nextConfig;
