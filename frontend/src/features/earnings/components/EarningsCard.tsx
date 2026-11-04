import { Link } from "react-router-dom";
import { formatDate } from "@/shared/lib/format";
import { ButtonLink, Card, ErrorBox, Loading, Money } from "@/shared/ui";
import { ArrowRightIcon } from "@/shared/ui/icons";
import { MoneyText } from "@/shared/ui/MoneyText";
import { useEarnings } from "../hooks";
import {
  ACHIEVEMENTS_HREF,
  cardState,
  currentMonthSalary,
  currentPaceText,
  followsUpdateGap,
  GAP_NOTE,
  hasEarningsData,
  hasUpdateGap,
  monthTitle,
  negativeMessage,
  paceText,
  readMonth,
  salaryComparison,
  SMALL_GAIN_CENTS,
  totalDetail,
} from "../lib/earnings";
import type { Earnings, EarningsMonth } from "../types";
import { Earned } from "./Earned";

const TITLE = "Salário do seu dinheiro";
const SUBTITLE = "Quanto seus investimentos renderam para você, sem contar o que você aportou.";
const UPDATE_HREF = "/carteira/atualizar";

const linkClass = "font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink";

/** Visão geral: a recompensa do mês, o total que o dinheiro já rendeu e o ritmo. */
export function EarningsCard() {
  const earnings = useEarnings();
  const data = earnings.data;

  if (earnings.isLoading) {
    return (
      <Card title={TITLE}>
        <Loading />
      </Card>
    );
  }
  if (earnings.error) {
    return (
      <Card title={TITLE}>
        <ErrorBox error={earnings.error} />
        <p className="mt-2 text-base text-ink-2">Recarregue a página em instantes para ver quanto seu dinheiro rendeu.</p>
      </Card>
    );
  }
  // Sem ativos a Visão geral já mostra as boas-vindas: o cartão não aparece.
  if (!hasEarningsData(data)) return null;

  return (
    <Card title={TITLE}>
      <p className="-mt-2 text-base text-ink-2">{SUBTITLE}</p>
      {cardState(data) === "starting" ? <Starting data={data} /> : <Full data={data} />}
      <Link to={ACHIEVEMENTS_HREF} className={`mt-4 inline-flex min-h-10 items-center ${linkClass}`}>
        Ver o mês em detalhe
      </Link>
    </Card>
  );
}

/** Acabou de cadastrar: em vez de "rendeu R$ 0,00", diz quando o primeiro salário aparece. */
function Starting({ data }: { data: Earnings }) {
  return (
    <div className="mt-4">
      <p className="font-serif text-3xl text-jade">Seu dinheiro começou a trabalhar.</p>
      <p className="mt-1 text-base text-ink-2">No fim do mês, atualize os saldos para ver o primeiro salário dele.</p>
      <ButtonLink to={UPDATE_HREF} variant="secondary" size="sm" className="mt-4">
        Atualizar saldos <ArrowRightIcon className="size-4" />
      </ButtonLink>
      <div className="mt-5 text-base text-ink-2">
        <p className="font-medium text-ink">Depois do primeiro mês completo, aqui aparecem:</p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
          <li>o salário de cada mês, sem contar os aportes;</li>
          <li>quanto seu dinheiro já rendeu no total e o ritmo por dia;</li>
          <li>quanto isso representa do seu salário e as conquistas pelo caminho.</li>
        </ul>
      </div>
      {data.tracking_since && (
        <p className="mt-3 text-sm text-ink-3">Acompanhando desde {formatDate(data.tracking_since)}.</p>
      )}
    </div>
  );
}

function Full({ data }: { data: Earnings }) {
  const current = data.current_month;
  const last = data.last_complete_month;
  const negative = negativeMessage(data);
  const currentPace = currentPaceText(current);

  return (
    <div className="mt-5 space-y-5">
      <dl>
        <CurrentMonth month={current} gap={followsUpdateGap(data.months, current.month, data.tracking_since)} />
      </dl>

      {negative && (
        <p className="rounded-field bg-raise px-4 py-3 text-base text-ink-2">
          <MoneyText parts={negative} />
        </p>
      )}

      <SalaryLine data={data} />
      {currentPace && (
        <p className="text-base font-medium">
          <MoneyText parts={currentPace} />
        </p>
      )}

      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {last && (
          <div>
            <dt className="text-sm text-ink-3">{monthTitle(last)}</dt>
            <dd className="mt-1 font-serif text-2xl">
              <MonthValue month={last} />
            </dd>
            <dd className="text-sm text-ink-3">
              último mês completo{followsUpdateGap(data.months, last.month, data.tracking_since) && `; ${GAP_NOTE}`}
            </dd>
          </div>
        )}
        <TotalEarned data={data} />
        <div>
          <dt className="text-sm text-ink-3">Ritmo</dt>
          {data.pace ? (
            <>
              <dd className="mt-1 text-base font-medium">
                <MoneyText parts={paceText(data.pace).main} />
              </dd>
              <dd className="text-sm text-ink-3">{paceText(data.pace).basis}</dd>
              {hasUpdateGap(data) && (
                <dd className="text-sm text-ink-3">
                  O ritmo usa só meses com atualização de saldo; um mês que vem depois de outro sem atualização pode concentrar o
                  rendimento dos dois.
                </dd>
              )}
            </>
          ) : (
            <dd className="mt-1 text-base text-ink-2">O ritmo aparece depois do primeiro mês completo.</dd>
          )}
        </div>
      </dl>

      <p className="text-sm text-ink-3">
        O rendimento entra no mês em que você atualiza o saldo de cada ativo; proventos contam no mês em que chegam.
      </p>
    </div>
  );
}

function CurrentMonth({ month, gap }: { month: EarningsMonth; gap: boolean }) {
  const reading = readMonth(month);
  return (
    <div>
      <dt className="text-base text-ink-2">{monthTitle(month)}</dt>
      {reading === "no_update" ? (
        <>
          <dd className="mt-1 font-serif text-3xl">Ainda sem atualização de saldo</dd>
          <dd className="mt-1 text-base text-ink-2">
            O salário do mês aparece quando você atualiza os saldos.{" "}
            <Link to={UPDATE_HREF} className={linkClass}>
              Atualizar saldos
            </Link>
          </dd>
        </>
      ) : reading === "starting" ? (
        <>
          <dd className="mt-1 font-serif text-3xl text-jade">Seu dinheiro começou a trabalhar</dd>
          {month.earned_cents > 0 && (
            <dd className="mt-1 text-base text-ink-2">
              <Earned cents={month.earned_cents} /> até agora, pelas atualizações de saldo.
            </dd>
          )}
        </>
      ) : (
        <>
          {/* A coluna é estreita (o outro mês fica ao lado): com milhares de reais, 5xl encostava na divisória. */}
          <dd className="mt-1 font-serif text-4xl sm:text-5xl">
            <Earned cents={month.earned_cents} />
          </dd>
          <dd className="mt-1 text-base text-ink-2">
            {reading === "negative" ? "de oscilação no mês" : "rendidos para você"}, pelas atualizações de saldo
            {month.proventos_cents !== 0 && (
              <>
                {" "}
                (<Money cents={month.appreciation_cents} /> de valorização e <Money cents={month.proventos_cents} /> de proventos)
              </>
            )}
            .
          </dd>
        </>
      )}
      {gap && (
        <dd className="mt-1 text-sm text-ink-3">
          Este valor {GAP_NOTE}: o rendimento deles entrou aqui, na atualização.
        </dd>
      )}
    </div>
  );
}

/** Valor compacto de um mês, já dizendo quando não há o que medir. */
export function MonthValue({ month }: { month: EarningsMonth }) {
  const reading = readMonth(month);
  if (reading === "no_update") return <span className="font-sans text-base font-normal text-ink-2">sem atualização de saldo</span>;
  if (reading === "starting" && month.earned_cents === 0) {
    return <span className="font-sans text-base font-normal text-ink-2">seu dinheiro começou a trabalhar</span>;
  }
  return <Earned cents={month.earned_cents} />;
}

function TotalEarned({ data }: { data: Earnings }) {
  const total = data.total.earned_cents;
  const detail = totalDetail(data);
  return (
    <div>
      <dt className="text-sm text-ink-3">Já rendeu no total</dt>
      <dd className="mt-1 font-serif text-2xl">
        {total >= 0 && total <= SMALL_GAIN_CENTS ? (
          <span className="font-sans text-base font-medium text-jade">Seu dinheiro começou a trabalhar</span>
        ) : (
          <>
            <Earned cents={total} />
            {total < 0 && <span className="font-sans text-base font-normal text-ink-2"> abaixo do investido</span>}
          </>
        )}
      </dd>
      {detail && (
        <dd className="text-sm text-ink-3">
          <MoneyText parts={detail} />
        </dd>
      )}
    </div>
  );
}

/** O mês em andamento primeiro, para acompanhar; o último mês completo logo abaixo, para comparar. */
function SalaryLine({ data }: { data: Earnings }) {
  const current = currentMonthSalary(data);
  return (
    <div className="space-y-1">
      {current && (
        <p className="text-base text-ink">
          Em {current.month}, até {current.through}: <strong className="tabular">{current.share}</strong> do seu salário
          {current.work && (
            <>
              {" "}
              · equivale a <strong className="tabular">{current.work}</strong> do seu trabalho
            </>
          )}
        </p>
      )}
      <PreviousMonthSalaryLine data={data} />
    </div>
  );
}

function PreviousMonthSalaryLine({ data }: { data: Earnings }) {
  const comparison = salaryComparison(data);
  const base = "text-base text-ink-2";
  if (comparison.kind === "no_salary") {
    return (
      <p className={base}>
        <Link to="/aporte" className={linkClass}>
          Registre o salário no aporte do mês
        </Link>{" "}
        para comparar o que seu dinheiro rende com o que você ganha trabalhando.
      </p>
    );
  }
  if (comparison.kind === "waiting") {
    return <p className={base}>A comparação com o seu salário aparece depois do primeiro mês completo.</p>;
  }
  if (comparison.kind === "flat") {
    return <p className={base}>Em {comparison.month} seus saldos ficaram iguais; o rendimento aparece quando o saldo mudar.</p>;
  }
  if (comparison.kind === "dip") {
    return <p className={base}>No último mês completo houve oscilação, então não há ganho para comparar com o salário.</p>;
  }
  return (
    <p className="text-base text-ink">
      Em {comparison.month}: <strong className="tabular">{comparison.share}</strong> do seu salário
      {comparison.work && (
        <>
          {" "}
          · equivale a <strong className="tabular">{comparison.work}</strong> do seu trabalho
        </>
      )}
    </p>
  );
}
