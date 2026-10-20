import { useEffect, useRef, useState } from 'react';

/** Interpola un número hacia su nuevo valor (conteo animado de KPIs). */
export function useTween(value: number, ms = 550) {
  const [v, setV] = useState(value * 0.6);
  const from = useRef(value * 0.6);
  useEffect(() => {
    const a = from.current, t0 = performance.now(); let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3), x = a + (value - a) * e;
      from.current = x; setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}
