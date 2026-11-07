import { formatDate, formatMonth } from "@/shared/lib/format";

/** As referências de mercado que a pessoa pode pôr ao lado da carteira (o CDI vem sempre e tem o próprio aviso). */
export type BenchmarkKey = "ibovespa" | "usd" | "ipca";

/** Por que falta a referência: nunca baixada, ou baixada só até uma data anterior ao fim do período. */
export type BenchmarkGap = { kind: "missing" } | { kind: "partial"; through: string };

/** Valor de uma linha e até onde a referência vai para ela (dia AAAA-MM-DD, ou mês AAAA-MM no IPCA). */
interface Coverage {
  bps: number | null;
  through: string | null;
}

/**
 * Um único diagnóstico para várias linhas (ativos de uma tabela): se alguma ficou sem a referência, diz se ela
 * nunca foi baixada ou até onde ela vai. Datas ISO comparam como texto.
 */
export function benchmarkGap(items: readonly Coverage[]): BenchmarkGap | null {
  if (!items.some((item) => item.bps === null)) return null;
  const through = items
    .map((item) => item.through)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);
  return through ? { kind: "partial", through } : { kind: "missing" };
}

const NAME: Record<BenchmarkKey, { article: string; missing: string }> = {
  ibovespa: { article: "O Ibovespa", missing: "do Ibovespa" },
  usd: { article: "O dólar", missing: "do dólar" },
  ipca: { article: "O IPCA", missing: "do IPCA" },
};

/** "2026-09" vira "set/2026"; "2026-09-30" vira "30/09/2026". */
const formatThrough = (value: string) => (value.length === 7 ? formatMonth(value) : formatDate(value));

export function benchmarkGapMessage(key: BenchmarkKey, gap: BenchmarkGap): string {
  if (gap.kind === "missing") {
    return `Ainda não há dados ${NAME[key].missing}. Atualize os índices em Configurações → Dados e proteção.`;
  }
  // O IPCA sai com atraso: parar um mês antes do fim do período é normal, então a mensagem explica em vez de só mandar atualizar.
  return key === "ipca"
    ? `O IPCA só vai até ${formatThrough(gap.through)} (ele é divulgado com atraso); atualize os índices.`
    : `${NAME[key].article} só vai até ${formatThrough(gap.through)}; atualize os índices.`;
}

/**
 * Escopos de bolsa (qualquer categoria que não é renda fixa nem cripto) já abrem com o Ibovespa no gráfico. Um grupo
 * (`group:<id>`) conta como bolsa se alguma categoria dele é de bolsa; sem saber as categorias, fica desligado.
 * Cripto compara com o dólar, não com o Ibovespa (ele continua à escolha).
 */
export function ibovespaByDefault(scope: string, groupClassKeys?: readonly string[]): boolean {
  const isStock = (key: string) => key !== "renda_fixa" && key !== "cripto";
  if (scope.startsWith("group:")) return (groupClassKeys ?? []).some(isStock);
  return scope !== "total" && isStock(scope);
}

/** O dólar é a referência da cripto: só nessa categoria o back-end o calcula, e nela já abre ligado. */
export function usdByDefault(scope: string): boolean {
  return scope === "cripto";
}
