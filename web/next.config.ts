import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["https://192.168.10.116:9527"],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
