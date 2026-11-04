import { formatDate } from "@/shared/lib/format";

/** Por que falta o Ibovespa: nunca baixado, ou baixado só até um dia anterior ao fim do período. */
export type IbovespaGap = { kind: "missing" } | { kind: "partial"; through: string };

interface WithIbovespa {
  ibovespa_bps: number | null;
  ibovespa_covered_through: string | null;
}

/**
 * Um único diagnóstico para várias linhas (ativos de uma tabela): se alguma ficou sem Ibovespa,
 * diz se o índice nunca foi baixado ou até que dia ele vai. Datas ISO comparam como texto.
 */
export function ibovespaGap(items: readonly WithIbovespa[]): IbovespaGap | null {
  if (!items.some((item) => item.ibovespa_bps === null)) return null;
  const through = items
    .map((item) => item.ibovespa_covered_through)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);
  return through ? { kind: "partial", through } : { kind: "missing" };
}

export function ibovespaGapMessage(gap: IbovespaGap): string {
  return gap.kind === "missing"
    ? "Ainda não há dados do Ibovespa. Atualize os índices em Configurações → Dados e proteção."
    : `O Ibovespa só vai até ${formatDate(gap.through)}; atualize os índices.`;
}

/**
 * Escopos de bolsa (qualquer categoria que não é renda fixa) já abrem com o Ibovespa no gráfico. Um grupo
 * (`group:<id>`) conta como bolsa se alguma categoria dele não é renda fixa; sem saber as categorias, fica desligado.
 */
export function ibovespaByDefault(scope: string, groupClassKeys?: readonly string[]): boolean {
  if (scope.startsWith("group:")) return (groupClassKeys ?? []).some((key) => key !== "renda_fixa");
  return scope !== "total" && scope !== "renda_fixa";
}
