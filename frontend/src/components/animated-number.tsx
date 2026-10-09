"use client";

import { animate, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export function AnimatedNumber({
  value,
  format = (input: number) => String(Math.round(input)),
}: {
  value: number;
  format?: (value: number) => string;
}) {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    if (reducedMotion) {
      previous.current = value;
      setDisplay(value);
      return;
    }
    const controls = animate(previous.current, value, {
      duration: 0.5,
      ease: "easeOut",
      onUpdate: (latest) => setDisplay(latest),
      onComplete: () => {
        previous.current = value;
      },
    });
    return () => controls.stop();
  }, [value, reducedMotion]);

  return <span className="tabular-nums">{format(display)}</span>;
}
