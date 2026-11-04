import { useEffect, useRef, useState } from "react";
import { useDebounced } from "@/shared/hooks/useDebounced";
import { formatDate, parseMoneyToCents, todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Button, Field, inputClass, Loading, Money } from "@/shared/ui";
import { useApplyReconciliation, useReconcile } from "../hooks";
import { differenceWords, matchesText, MAX_CENTS, TOO_BIG } from "../lib/entries";
import type { Account } from "../types";
import { CashError, FormPanel, SignedMoney } from "./parts";

/**
 * Conciliação em dois passos: digitar o saldo do extrato e ver calculado x real x diferença (só leitura);
 * depois, se houver diferença, confirmar o ajuste já sabendo o efeito.
 */
export function ReconcileForm({
  account,
  onDone,
  onCancel,
}: {
  account: Account;
  onDone: (message: MoneyTextPart[]) => void;
  onCancel: () => void;
}) {
  const today = todayISO();
  const [real, setReal] = useState("");
  const [asOf, setAsOf] = useState(today);
  const [confirming, setConfirming] = useState(false);
  const apply = useApplyReconciliation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const adjustRef = useRef<HTMLButtonElement>(null);
  const backFromConfirm = useRef(false);

  const parsed = real.trim() === "" ? null : parseMoneyToCents(real);
  const tooBig = parsed !== null && parsed > MAX_CENTS;
  const realCents = tooBig ? null : parsed;
  const dateOk = asOf !== "" && asOf <= today && (!account.opening_date || asOf >= account.opening_date);
  const debouncedReal = useDebounced(realCents, 300);
  const check = useReconcile(account.id, debouncedReal, asOf, dateOk && !confirming);
  const result = check.data && check.data.real_cents === realCents && check.data.as_of === asOf ? check.data : null;

  // O botão "Ajustar" some ao confirmar: o foco vai para a confirmação e, ao voltar, para o botão de novo.
  useEffect(() => {
    if (confirming) dialogRef.current?.focus();
    else if (backFromConfirm.current) {
      backFromConfirm.current = false;
      adjustRef.current?.focus();
    }
  }, [confirming]);

  function confirm() {
    if (!result || realCents === null) return;
    apply.mutate(
      { id: account.id, realCents, asOf },
      {
        onSuccess: () =>
          onDone([
            "Caixa conferido: ajuste de ",
            { cents: Math.abs(result.difference_cents) },
            ` (${result.difference_cents > 0 ? "a mais" : "a menos"}) gravado em ${formatDate(asOf)}. O caixa agora confere com o extrato: `,
            { cents: result.real_cents },
            ".",
          ]),
      },
    );
  }

  const fieldError = real.trim() === "" ? null : parsed === null ? "Valor inválido. Use o formato 1.234,56." : tooBig ? TOO_BIG : null;

  return (
    <FormPanel
      title={`Conferir ${account.name} com o extrato`}
      intro="Digite o saldo disponível que aparece no extrato do banco ou da corretora. O app compara com o caixa que ele calculou; nada é gravado até você confirmar."
      onSubmit={() => setConfirming(true)}
    >
      <div className="flex flex-wrap items-start gap-4">
        <Field label="Saldo no extrato (R$)" error={fieldError} className="w-full sm:w-52">
          <input
            inputMode="decimal"
            className={`${inputClass} tabular min-h-10`}
            value={real}
            disabled={confirming}
            onChange={(e) => setReal(e.target.value)}
            placeholder="0,00"
          />
        </Field>
        <Field
          label="Data do extrato"
          error={
            asOf > today
              ? "A data não pode ser no futuro."
              : account.opening_date && asOf !== "" && asOf < account.opening_date
                ? `O caixa só existe a partir de ${formatDate(account.opening_date)}.`
                : null
          }
          className="w-full sm:w-52"
        >
          <input
            type="date"
            min={account.opening_date ?? undefined}
            max={today}
            disabled={confirming}
            className={`${inputClass} min-h-10`}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </Field>
      </div>

      {realCents !== null && dateOk && !result && check.isFetching && <Loading label="Comparando..." />}
      <CashError error={check.error} />

      {result && (
        <div>
          <dl className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-3 dark:border-slate-800">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Calculado pelo app em {formatDate(result.as_of)}</dt>
              <dd className="mt-0.5 font-serif text-lg font-semibold">
                <Money cents={result.calculated_cents} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">No extrato</dt>
              <dd className="mt-0.5 font-serif text-lg font-semibold">
                <Money cents={result.real_cents} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Diferença</dt>
              <dd className="mt-0.5 font-serif text-lg">
                {result.difference_cents === 0 ? <span className="font-semibold">Nenhuma</span> : <SignedMoney cents={result.difference_cents} />}
              </dd>
              {result.difference_cents !== 0 && (
                <dd className="text-xs text-slate-500 dark:text-slate-400">{differenceWords(result.difference_cents)}</dd>
              )}
            </div>
          </dl>

          {result.difference_cents === 0 ? (
            <div className="mt-3 space-y-3">
              <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                ✓ {matchesText(result.as_of, today)}
              </p>
              <Button variant="secondary" size="sm" onClick={onCancel}>
                Fechar
              </Button>
            </div>
          ) : confirming ? (
            <div
              ref={dialogRef}
              tabIndex={-1}
              role="alertdialog"
              aria-labelledby="confirmar-ajuste"
              aria-describedby="confirmar-ajuste-efeito"
              className="mt-3 space-y-3 rounded-lg border border-blue-500/60 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <p id="confirmar-ajuste" className="text-sm font-semibold">
                Confirmar o ajuste?
              </p>
              <p id="confirmar-ajuste-efeito" className="text-sm text-slate-700 dark:text-slate-300">
                Vai gravar um lançamento de ajuste de <SignedMoney cents={result.difference_cents} /> em {formatDate(result.as_of)}. O caixa
                calculado passa de <Money cents={result.calculated_cents} /> para <Money cents={result.real_cents} />, igual ao extrato. O
                capital aportado não muda. Se depois achar o lançamento que faltava, exclua o ajuste no extrato.
              </p>
              <CashError error={apply.error} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={apply.isPending} onClick={confirm}>
                  {apply.isPending ? "Gravando..." : "Confirmar ajuste"}
                </Button>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => {
                    backFromConfirm.current = true;
                    setConfirming(false);
                  }}
                >
                  Voltar
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Antes de ajustar, veja no extrato abaixo se falta registrar algo (um provento, uma taxa, um depósito). Se não faltar nada, grave
                o ajuste da diferença.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button ref={adjustRef} type="submit" size="sm">
                  Ajustar o caixa em {result.difference_cents > 0 ? "+" : "−"} <Money cents={Math.abs(result.difference_cents)} />
                </Button>
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!result && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled aria-describedby="conciliar-motivo">
            Ajustar o caixa
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <p id="conciliar-motivo" className="w-full text-xs text-slate-600 dark:text-slate-400">
            {realCents === null
              ? tooBig
                ? TOO_BIG
                : "Digite o saldo do extrato para comparar."
              : !dateOk
                ? "Corrija a data do extrato."
                : check.error
                  ? "Não deu para comparar; veja o aviso acima."
                  : "Comparando com o caixa calculado..."}
          </p>
        </div>
      )}
    </FormPanel>
  );
}
