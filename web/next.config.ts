import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["192.168.12.26", "localhost", "104.168.30.172", "10.61.75.69", "192.168.10.250"],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
