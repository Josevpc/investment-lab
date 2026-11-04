import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

const FADE = "1.75rem";

/**
 * Pista visual de que uma faixa rola na horizontal (abas no celular): esmaece a borda onde ainda há conteúdo
 * escondido. Sem rolagem possível, nada esmaece. Devolve o `ref` da faixa e o estilo a aplicar nela.
 */
export function useScrollEdges<T extends HTMLElement>(): { ref: RefObject<T | null>; style: CSSProperties | undefined } {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 2;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  if (!edges.start && !edges.end) return { ref, style: undefined };
  const image = `linear-gradient(to right, ${edges.start ? "transparent 0" : "#000 0"}, #000 ${edges.start ? FADE : "0"}, #000 calc(100% - ${edges.end ? FADE : "0px"}), ${edges.end ? "transparent 100%" : "#000 100%"})`;
  return { ref, style: { maskImage: image, WebkitMaskImage: image } };
}
