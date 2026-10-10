import type { NextConfig } from "next";

// 生产构建使用静态导出，由 nginx 同源反代 /api；
// 开发模式用 dev server rewrites 代理到本机后端（output: export 下 rewrites 不生效）。
const isDev = process.env.NODE_ENV === "development";
const devBackendUrl =
  process.env.DEV_BACKEND_URL ?? "http://localhost:18080";

const nextConfig: NextConfig = {
  ...(isDev
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${devBackendUrl}/api/:path*`,
            },
          ];
        },
      }
    : {
        output: "export" as const,
        // 静态导出使用目录形式的 HTML（login/index.html），nginx 可回退到 $uri/
        trailingSlash: true,
      }),
  images: { unoptimized: true },
  agentRules: false,
  // 开发时允许通过 127.0.0.1 访问 dev 资源（Playwright 与本地调试会用到）
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
