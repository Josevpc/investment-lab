import { useId } from "react";
import { SEPARATED } from "@/shared/lib/chart";

/** Id do padrão que os gráficos usam em `fill="url(#...)"`; fica dentro do <defs> do gráfico. */
export const SEPARATED_PATTERN_ID = "padrao-separado";

/** Hachura diagonal do dinheiro separado, para colocar dentro de um <defs> de gráfico. */
export function SeparatedPattern({ id = SEPARATED_PATTERN_ID }: { id?: string }) {
  return (
    <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" fill={SEPARATED} fillOpacity={0.1} />
      <line x1="0" y1="0" x2="0" y2="7" stroke={SEPARATED} strokeWidth="2" />
    </pattern>
  );
}

/** Amostra da legenda: faixa hachurada com contorno tracejado, como no gráfico. A palavra vem sempre ao lado. */
export function SeparatedSwatch({ className }: { className?: string }) {
  const id = `sw-${useId().replace(/:/g, "")}`;
  return (
    <svg aria-hidden width="30" height="14" className={className ?? "shrink-0"}>
      <defs>
        <SeparatedPattern id={id} />
      </defs>
      <rect x="1" y="1" width="28" height="12" rx="2" fill={`url(#${id})`} stroke={SEPARATED} strokeWidth="1.5" strokeDasharray="4 2" />
    </svg>
  );
}

/** Marca (círculo no contorno tracejado) para o `dot` da faixa: só nas datas com dinheiro separado. */
export function separatedDot({ cx, cy, payload, index }: { cx?: number; cy?: number; payload?: { separated?: number }; index?: number }) {
  if (cx === undefined || cy === undefined || !payload?.separated) return <g key={index} />;
  return <circle key={index} cx={cx} cy={cy} r={3.5} fill={SEPARATED} stroke={SEPARATED} />;
}
