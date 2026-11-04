import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cx } from "./primitives";
import { useScrollEdges } from "./scrollEdges";

/** Diferença de até 1 px é arredondamento, não rolagem. */
const TOLERANCE = 1;

/**
 * Faixa que rola na horizontal. Só vira parada de Tab (e região com nome) quando o conteúdo realmente não
 * cabe; sem rolagem, o teclado pula direto para o que importa. Com rolagem, o foco permite usar as setas, e a borda
 * com conteúdo escondido esmaece (a pista visual de que dá para arrastar).
 */
export function ScrollRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const { ref, style } = useScrollEdges<HTMLDivElement>();
  const [scrolls, setScrolls] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setScrolls(el.scrollWidth - el.clientWidth > TOLERANCE);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    // O conteúdo pode crescer (valores maiores, novas linhas) sem o contêiner mudar de tamanho.
    observer?.observe(el);
    for (const child of Array.from(el.children)) observer?.observe(child);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [ref, measure, children]);

  return (
    <div
      ref={ref}
      style={style}
      className={cx("overflow-x-auto", className)}
      {...(scrolls ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
    >
      {children}
    </div>
  );
}
