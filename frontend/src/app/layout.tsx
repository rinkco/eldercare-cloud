import type { Metadata } from "next";
import type { ReactNode } from "react";

import { MotionProvider } from "@/components/motion-provider";
import { ToastProvider } from "@/components/ui/toast";
import { AuthProvider } from "@/lib/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "老人监护云",
    template: "%s · 老人监护云",
  },
  description: "老人跌倒检测健康监护系统 Web 管理台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <MotionProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
