import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `node:sqlite` is a Node builtin used by the data layer; keep it server-side.
  serverExternalPackages: [],
};

export default nextConfig;
