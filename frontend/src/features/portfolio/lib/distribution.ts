import type { Asset, GroupBreakdown } from "../types";

/**
 * Máximo de fatias na pizza. Passou disso, os menores ativos entram em "Outros": a paleta categórica
 * tem 6 tons de terra, e a 7ª cor não se distinguiria das demais.
 */
export const MAX_SLICES = 6;

/**
 * Participação mínima (em pontos-base) para um ativo ter fatia própria. A fatia tem cantos arredondados e
 * espaço entre as vizinhas; abaixo de uns 3% ela fica mais estreita que os dois cantos juntos e invade as
 * vizinhas. Quem fica abaixo entra em "Outros" (e na tabela continua com o percentual real).
 */
export const MIN_SLICE_BPS = 300;

export interface Slice {
  key: string;
  label: string;
  cents: number;
  /**
   * Valor só para o desenho da pizza (nunca para exibir): igual a `cents`, exceto em "Outros", que sobe até
   * ocupar MIN_SLICE_BPS do que está desenhado, para a fatia não sumir (as demais encolhem um pouco, na mesma proporção).
   * Legenda, rótulo, dica e tabela usam `cents`/`bps`.
   */
  plotCents: number;
  /** Participação no total, em pontos-base (arredondada meio para cima). */
  bps: number;
  /** Posição na paleta categórica; null em "Outros", que fica em cinza. */
  slot: number | null;
  reserve: boolean;
  /** Nomes dos ativos reunidos em "Outros" (vazio nas demais). */
  folded: string[];
}

export interface DistributionRow {
  asset: Asset;
  bps: number;
}

export interface Distribution {
  totalCents: number;
  slices: Slice[];
  /** Todos os ativos, do maior para o menor: é o que a tabela mostra, sem agrupar nada. */
  rows: DistributionRow[];
  /** Data do saldo mais recente entre os ativos. */
  asOf: string | null;
}

function share(cents: number, totalCents: number): number {
  if (totalCents <= 0) return 0;
  const total = BigInt(totalCents);
  return Number((2n * BigInt(cents) * 10_000n + total) / (2n * total));
}

const byValueThenName = (a: Asset, b: Asset) => b.current_cents - a.current_cents || a.name.localeCompare(b.name, "pt-BR");

/**
 * Menor valor de desenho que dá a "Outros" MIN_SLICE_BPS do desenhado, dado o que as outras fatias somam:
 * p / (p + resto) >= min  =>  p >= resto * min / (10.000 - min), arredondado para cima. Em BigInt, como no resto.
 */
function minPlotCents(keptCents: number): number {
  const min = BigInt(MIN_SLICE_BPS);
  const denominator = 10_000n - min;
  return Number((BigInt(keptCents) * min + denominator - 1n) / denominator);
}

/**
 * Distribuição da carteira atual, ativo por ativo. As fatias seguem do maior para o menor e cada uma
 * ocupa a posição seguinte da paleta, então fatias vizinhas usam cores vizinhas (as que a validação
 * garante distintas).
 */
export function assetDistribution(assets: readonly Asset[]): Distribution {
  const sorted = [...assets].sort(byValueThenName);
  const totalCents = sorted.reduce((sum, a) => sum + a.current_cents, 0);
  const rows = sorted.map((asset) => ({ asset, bps: share(asset.current_cents, totalCents) }));
  const asOf = sorted.reduce<string | null>((latest, a) => (latest === null || a.valuation_date > latest ? a.valuation_date : latest), null);

  const funded = sorted.filter((a) => a.current_cents > 0);
  const single = (a: Asset, slot: number): Slice => ({
    key: String(a.id),
    label: a.name,
    cents: a.current_cents,
    plotCents: a.current_cents,
    bps: share(a.current_cents, totalCents),
    slot,
    reserve: a.purpose === "reserva",
    folded: [],
  });

  // Do maior para o menor, então quem tem fatia própria é sempre um prefixo; o resto vai para "Outros".
  const sizable = funded.filter((a) => share(a.current_cents, totalCents) >= MIN_SLICE_BPS);
  const hasThin = sizable.length < funded.length;
  const keepCount = sizable.length + (hasThin ? 1 : 0) <= MAX_SLICES ? sizable.length : MAX_SLICES - 1;
  const kept = funded.slice(0, keepCount);
  const rest = funded.slice(keepCount);
  const slices = kept.map(single);

  if (rest.length > 0) {
    const restCents = rest.reduce((sum, a) => sum + a.current_cents, 0);
    const bps = share(restCents, totalCents);
    // Resto que arredonda para 0% não tem fatia nem linha na legenda; a tabela segue mostrando cada ativo.
    if (bps > 0) {
      slices.push({
        key: "others",
        label: "Outros",
        cents: restCents,
        plotCents: Math.max(restCents, minPlotCents(kept.reduce((sum, a) => sum + a.current_cents, 0))),
        bps,
        slot: null,
        reserve: false,
        folded: rest.map((a) => a.name),
      });
    }
  }
  return { totalCents, slices, rows, asOf };
}

export interface GroupRow {
  key: string;
  label: string;
  /** Cor do grupo; null em "Sem grupo", que fica em cinza. */
  color: string | null;
  currentCents: number;
  investedCents: number;
  /** Participação nos investimentos (sem a reserva), em pontos-base. */
  bps: number;
  grouped: boolean;
}

/**
 * Distribuição por grupo, do maior para o menor. O resumo da carteira só traz grupos com categorias, então o
 * que sobra dos investimentos (categorias sem grupo) entra em "Sem grupo" e as linhas fecham o total.
 */
export function groupDistribution(
  byGroup: readonly GroupBreakdown[],
  investments: { currentCents: number; investedCents: number },
): GroupRow[] {
  const rows: GroupRow[] = [...byGroup]
    .sort((a, b) => b.current_cents - a.current_cents || a.name.localeCompare(b.name, "pt-BR"))
    .map((g) => ({
      key: `group-${g.group_id}`,
      label: g.name,
      color: g.color,
      currentCents: g.current_cents,
      investedCents: g.invested_cents,
      bps: g.share_bps,
      grouped: true,
    }));
  const restCurrent = investments.currentCents - byGroup.reduce((sum, g) => sum + g.current_cents, 0);
  const restInvested = investments.investedCents - byGroup.reduce((sum, g) => sum + g.invested_cents, 0);
  if (restCurrent > 0 || restInvested > 0) {
    rows.push({
      key: "no-group",
      label: "Sem grupo",
      color: null,
      currentCents: Math.max(restCurrent, 0),
      investedCents: Math.max(restInvested, 0),
      bps: share(Math.max(restCurrent, 0), investments.currentCents),
      grouped: false,
    });
  }
  return rows;
}
