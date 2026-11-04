import { formatDate, formatMonth } from "@/shared/lib/format";
import { Button, Card, ErrorBox, Loading, Notice } from "@/shared/ui";
import { useBenchmarkStatus, useRefreshBenchmarks } from "./hooks";

function formatDateTime(iso: string): string {
  return `${formatDate(iso.slice(0, 10))} às ${iso.slice(11, 16)}`;
}

const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** Situação dos índices de referência (CDI, Selic e Ibovespa) e o botão de atualizar. */
export function BenchmarksCard() {
  const status = useBenchmarkStatus();
  const refresh = useRefreshBenchmarks();
  const s = status.data;
  const result = refresh.data;

  return (
    <Card
      title="CDI, Selic e Ibovespa (índices de referência)"
      action={
        <Button variant="secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? "Atualizando..." : "Atualizar agora"}
        </Button>
      }
    >
      {status.isLoading && <Loading />}
      <ErrorBox error={status.error} />
      {s && (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600 dark:text-slate-400">
            Usados no gráfico <strong>Sua carteira vs. mercado</strong> e no % do CDI de cada ativo, em Histórico e na Carteira; o
            Ibovespa serve de comparação para a renda variável. Fonte: <strong>{s.source}</strong>. A atualização busca os dados na
            internet e acontece sozinha quando o app abre e os dados estão velhos; sem internet, o app continua funcionando com o que já
            foi baixado.
          </p>
          <p>
            Última atualização: <strong>{s.updated_at ? formatDateTime(s.updated_at) : "ainda não houve"}</strong>
            {s.stale && <span className="ml-2 text-red-600 dark:text-red-400">(desatualizado)</span>}
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {s.series.map((serie) => (
              <li key={serie.series} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span className="font-medium">{serie.label}</span>
                <span className="tabular text-slate-600 dark:text-slate-400">
                  {serie.months === 0 || !serie.covered_from || !serie.covered_through
                    ? "sem dados"
                    : `${serie.months} meses, de ${formatMonth(serie.covered_from)} a ${formatMonth(serie.covered_through)}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-slate-600 dark:text-slate-400">
            CDI diário (para medir quantos % do CDI cada ativo rendeu):{" "}
            <strong>
              {s.daily_days === 0 || !s.daily_through ? "ainda não baixado" : `${s.daily_days} dias, até ${formatDate(s.daily_through)}`}
            </strong>
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            Ibovespa (para comparar renda variável e cripto):{" "}
            <strong>
              {s.index_days === 0 || !s.index_through ? "ainda não baixado" : `${s.index_days} dias, até ${formatDate(s.index_through)}`}
            </strong>
          </p>
        </div>
      )}
      <div className="mt-3 space-y-2">
        <ErrorBox error={refresh.error} />
        {result?.ok && (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            Atualizado: {result.rows_saved} {result.rows_saved === 1 ? "valor gravado" : "valores gravados"}. Os gráficos de desempenho
            já usam os dados novos.
          </p>
        )}
        {/* Sucesso parcial: o CDI foi salvo e só o Ibovespa (ou outra série) falhou. Avisa sem esconder o sucesso. */}
        {result?.ok && result.errors.length > 0 && (
          <Notice tone="warn">
            {result.errors.map(sentence).join(" ")} O restante foi salvo; tente atualizar de novo mais tarde.
          </Notice>
        )}
        {result && !result.ok && <ErrorBox error={`Não foi possível atualizar: ${result.errors.map(sentence).join(" ")}`} />}
      </div>
    </Card>
  );
}
