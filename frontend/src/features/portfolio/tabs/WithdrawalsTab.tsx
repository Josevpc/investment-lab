import { useState } from "react";
import { Link } from "react-router-dom";
import { useReserve } from "@/features/reserve";
import { formatDate } from "@/shared/lib/format";
import { Badge, Button, ButtonLink, Card, cx, Empty, ErrorBox, inputClass, Loading, Money } from "@/shared/ui";
import { Figure } from "@/shared/ui/Figure";
import { useWithdrawals } from "../hooks";
import type { Withdrawal } from "../types";

const LINK = "inline-flex min-h-10 items-center font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink";

const NEW_REDEMPTION = "/carteira/movimentacoes?novo=resgate";

function countLabel(count: number): string {
  return count === 1 ? "1 retirada" : `${count} retiradas`;
}

/**
 * Como a reserva ficou depois do resgate. "Ficou com" é histórico (o saldo daquele dia); a meta é a de hoje,
 * por isso "atual". Sem saldo digitado depois do resgate não há o que dizer, e a tela diz isso em vez de calar.
 */
function ReserveAfter({ w }: { w: Withdrawal }) {
  const style = "mt-1 text-sm text-ink-2";
  if (w.effective_date === null || w.reserve_balance_after_cents === null) {
    return <p className={style}>Ainda não há saldo digitado depois deste resgate, então não dá para ver como a reserva ficou.</p>;
  }
  const below = w.reserve_below_goal_cents;
  return (
    <p className={style}>
      A reserva ficou com <Money cents={w.reserve_balance_after_cents} className="font-medium" />
      {below !== null && (below > 0 ? <> (<Money cents={below} /> abaixo da meta atual)</> : " (dentro da meta atual)")}. Saldo de{" "}
      {formatDate(w.effective_date)}.
    </p>
  );
}

// As linhas são faixas `raise` arredondadas: a tabela separa as linhas por espaço, não por traço. No celular cada
// linha vira um cartão (data e valor em cima); a partir de md volta a ser linha de tabela.
const CELL = "md:table-cell md:bg-raise md:px-4 md:py-4 md:align-top";

function WithdrawalRow({ w }: { w: Withdrawal }) {
  return (
    <tr role="row" className="mb-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 rounded-field bg-raise p-4 md:mb-0 md:table-row md:bg-transparent md:p-0">
      <td role="cell" className={cx(CELL, "tabular col-start-1 row-start-1 whitespace-nowrap text-ink-2 md:rounded-l-field")}>{formatDate(w.date)}</td>
      <td role="cell" className={cx(CELL, "col-span-2 row-start-2 min-w-0 break-words")}>
        <span className="font-medium">{w.asset_name}</span>
        <span className="text-ink-2"> · {w.institution_name}</span>
        {w.asset_archived && (
          <>
            {" "}
            <Badge>Arquivado</Badge>
          </>
        )}
        <span className="mt-1 block">
          <span className="md:sr-only">Motivo: </span>
          {w.note ? w.note : <span className="text-ink-3">Sem motivo</span>}
          {w.from_reserve && (
            <>
              {" "}
              <Badge tone="good">Reserva</Badge>
            </>
          )}
        </span>
        {w.from_reserve && <ReserveAfter w={w} />}
      </td>
      <td role="cell" className={cx(CELL, "col-start-2 row-start-1 text-right md:rounded-r-field")}>
        <span className="tabular block whitespace-nowrap font-medium">
          − <Money cents={w.amount_cents} />
        </span>
        <Link
          to={`/carteira/movimentacoes?mes=${w.date.slice(0, 7)}`}
          aria-label={`Corrigir em Movimentações: retirada de ${w.asset_name} em ${formatDate(w.date)}`}
          className={cx(LINK, "text-sm md:whitespace-nowrap")}
        >
          Corrigir em Movimentações
        </Link>
      </td>
    </tr>
  );
}

/** Onde a reserva está hoje, para quem acabou de ver que tirou dinheiro dela: argila quando falta repor, jade quando está completa. */
function ReserveNow() {
  const reserve = useReserve();
  const r = reserve.data;
  const zone = "rounded-card p-5 text-base text-ink sm:p-7";

  if (reserve.isError) {
    return (
      <div className={cx(zone, "bg-raise")}>
        <strong className="font-medium">Reserva de emergência:</strong> não foi possível carregar a situação da reserva agora. A lista de
        retiradas abaixo não depende dela. Recarregue a página para tentar de novo.
      </div>
    );
  }
  if (!r) return <div className={cx(zone, "bg-raise text-ink-2")}>Carregando a reserva…</div>;

  if (r.goal_cents <= 0) {
    return (
      <div className={cx(zone, "bg-raise")}>
        <Link to="/configuracoes#reserva" className={LINK}>
          Defina a meta da reserva
        </Link>{" "}
        para saber quanto falta repor depois de um resgate.
      </div>
    );
  }
  if (r.reached) {
    return (
      <div className={cx(zone, "bg-jade-t")}>
        <strong className="font-medium">Reserva completa.</strong> Hoje ela tem <Money cents={r.balance_cents} /> de <Money cents={r.goal_cents} />.
      </div>
    );
  }
  return (
    <div className={cx(zone, "bg-clay-t")}>
      <p>
        Reserva de emergência, hoje: <Money cents={r.balance_cents} /> de <Money cents={r.goal_cents} />. Faltam{" "}
        <strong className="font-medium">
          <Money cents={r.remaining_cents} />
        </strong>{" "}
        para repor.
      </p>
      <Link to="/aporte" className={cx(LINK, "mt-1")}>
        Registrar aporte
      </Link>
    </div>
  );
}

/**
 * Tudo o que saiu dos ativos por resgate. É uma tela de leitura: corrigir ou desfazer um resgate continua em
 * Movimentações (cada linha leva ao mês certo). A ação principal é registrar um novo resgate.
 */
export function WithdrawalsTab() {
  const [year, setYear] = useState("");
  const withdrawals = useWithdrawals(year === "" ? null : Number(year));
  const data = withdrawals.data;
  // Durante a troca de ano a lista anterior continua na tela, esmaecida, até a nova chegar.
  const refreshing = withdrawals.isPlaceholderData;

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Retiradas da carteira: tudo o que você resgatou dos ativos</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data && data.years.length > 0 ? (
          <label className="flex items-center gap-3 text-base text-ink-2">
            Ano
            <select
              className={cx(inputClass, "w-auto rounded-full py-2.5 pl-5 pr-4")}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="">Todos</option>
              {data.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
        <ButtonLink to={NEW_REDEMPTION}>Registrar resgate</ButtonLink>
      </div>

      {withdrawals.isLoading && <Loading />}
      {withdrawals.isError && (
        <div className="space-y-3">
          <ErrorBox error={withdrawals.error} />
          <p className="text-base text-ink-2">Recarregue a página para tentar de novo.</p>
          <Button variant="secondary" onClick={() => void withdrawals.refetch()}>
            Tentar de novo
          </Button>
        </div>
      )}

      {data && (
        <div className={cx("space-y-6 transition-opacity", refreshing && "opacity-60")} aria-busy={refreshing}>
          {data.count === 0 ? (
            <Card>
              <Empty>
                Nenhuma retirada registrada{year !== "" && ` em ${year}`}. Quando tirar dinheiro de um ativo, use Resgatar em Movimentações:
                o saldo e o investido caem juntos e nada aparece como prejuízo.
              </Empty>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-6">
                <section aria-label="Total retirado" className="rounded-card bg-soil p-5 sm:p-7">
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))] gap-x-8 gap-y-5">
                    <Figure
                      label="Total retirado"
                      value={<Money cents={data.total_cents} />}
                      hint={`${countLabel(data.count)}${year !== "" ? ` em ${year}` : ""}`}
                    />
                    {data.reserve_total_cents > 0 && (
                      <Figure label="Da reserva" value={<Money cents={data.reserve_total_cents} />} hint="parte do total que saiu da reserva" />
                    )}
                  </div>
                </section>
                <ReserveNow />
              </div>

              {/* No celular a tabela vira cartões (display: block), e alguns navegadores então descartam a semântica de tabela:
                  os papéis explícitos a mantêm para leitores de tela. */}
              <table role="table" className="block w-full text-base md:table md:border-separate md:border-spacing-y-2">
                <caption className="sr-only">Retiradas{year !== "" ? ` de ${year}` : ""}, da mais recente para a mais antiga</caption>
                <thead role="rowgroup" className="sr-only md:table-header-group md:not-sr-only">
                  <tr role="row" className="text-left text-sm text-ink-3">
                    <th role="columnheader" scope="col" className="px-4 pb-1 font-normal">
                      Data
                    </th>
                    <th role="columnheader" scope="col" className="px-4 pb-1 font-normal">
                      Ativo e motivo
                    </th>
                    <th role="columnheader" scope="col" className="px-4 pb-1 text-right font-normal">
                      Valor
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup" className="block md:table-row-group">
                  {data.items.map((w) => (
                    <WithdrawalRow key={w.movement_id} w={w} />
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <p className="text-sm text-ink-2">As retiradas do caixa das contas ficam no extrato de cada conta.</p>
    </div>
  );
}
