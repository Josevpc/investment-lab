import { Link } from "react-router-dom";
import { usePerformance } from "@/features/analytics";
import { rangeLabel, rangeStart, type RangeKey } from "@/features/history";
import { formatPointsDiff, formatSignedPercent } from "@/shared/lib/format";
import { Badge, Card, ErrorBox, Loading } from "@/shared/ui";
import { PebbleBar } from "@/shared/ui/PebbleBar";
import { comparisonBars, shareOfCdi } from "../lib/cdi";

const linkClass = "inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink";

function BarRow({ name, bps, widthBps, color }: { name: string; bps: number | null; widthBps: number; color: string }) {
  const text = bps === null ? "—" : formatSignedPercent(bps);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base text-ink-2">{name}</span>
        <span className="tabular font-serif text-2xl">{text}</span>
      </div>
      <PebbleBar role="img" valueBps={widthBps} color={color} className="mt-2" label={`${name}: ${text} no período`} />
    </div>
  );
}

/** Carteira contra o CDI no período escolhido: duas barras seixo, o quanto do CDI a carteira rendeu e a diferença em pontos. */
export function PerformanceCard({ range }: { range: RangeKey }) {
  const performance = usePerformance({ scope: "total", includeReserve: false, from: rangeStart(range) });
  const p = performance.data;
  const summary = p?.summary;
  // Com uma data só o back-end devolve 0% (início = fim): não é um resultado.
  const ready = summary && summary.portfolio_bps !== null && (p?.observations_count ?? 0) >= 2;
  const share = ready ? shareOfCdi(summary.portfolio_bps, summary.cdi_bps) : null;
  const bars = ready ? comparisonBars(summary.portfolio_bps, summary.cdi_bps) : null;

  return (
    <Card title="Desempenho no período" action={<span className="text-sm text-ink-3">{rangeLabel(range)}</span>}>
      {performance.isLoading && <Loading />}
      <ErrorBox error={performance.error} />
      {p && !ready && (
        <p className="text-base text-ink-2">
          {p.observations_count < 2
            ? "Atualize os saldos em pelo menos duas datas para comparar com o CDI."
            : (p.warnings[0] ?? "Não há saldos suficientes neste período para comparar o desempenho.")}{" "}
          <Link to="/carteira/atualizar" className={linkClass}>
            Atualizar saldos
          </Link>
        </p>
      )}
      {p && ready && summary && bars && (
        <div className="space-y-5">
          <BarRow name="Carteira" bps={summary.portfolio_bps} widthBps={bars.a} color="var(--ink)" />
          <BarRow name="CDI" bps={summary.cdi_bps} widthBps={bars.b} color="var(--ink-3)" />

          {share !== null && (
            <p className="flex flex-wrap items-center gap-2 text-base">
              <Badge tone={share >= 100 ? "good" : "neutral"}>Você rendeu {share}% do CDI</Badge>
              {summary.vs_cdi_bps !== null && (
                <span className="text-ink-2">
                  Diferença para o CDI: <strong className="tabular font-medium text-ink">{formatPointsDiff(summary.vs_cdi_bps)}</strong>
                </span>
              )}
            </p>
          )}
          {share === null && summary.cdi_bps === null && (
            <p className="text-sm text-ink-3">
              O CDI baixado não chega até a última data. Atualize os índices em{" "}
              <Link to="/configuracoes" className={linkClass}>
                Configurações
              </Link>
              .
            </p>
          )}
          <p className="text-sm text-ink-3">Sem a reserva de emergência. Aportes e resgates não contam como rendimento.</p>
        </div>
      )}
      <Link to={`/historico?aba=desempenho&periodo=${range}`} className={`${linkClass} mt-3`}>
        Entender como é calculado
      </Link>
    </Card>
  );
}
