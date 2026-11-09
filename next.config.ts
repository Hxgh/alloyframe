import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // 开发资源默认只放行 localhost。这里按私有网段放行，换 Wi-Fi / 热点无需再改地址；
  // 通配符只匹配域名标签，写 "*" 或 "**" 反而会拦掉局域网 IP。
  allowedDevOrigins: ["10.*.*.*", "172.*.*.*", "192.168.*.*", "169.254.*.*", "*.local"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
