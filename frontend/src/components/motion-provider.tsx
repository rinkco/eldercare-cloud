"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

// 让 Framer Motion 在用户开启“减少动态效果”时自动降级动画
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
