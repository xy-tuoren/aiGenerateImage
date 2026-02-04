import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["192.168.10.116", "localhost"],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
