import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, cx, ErrorBox, Money } from "@/shared/ui";
import { cashErrorHint, signOf } from "../lib/entries";

/** Valor com sinal escrito (+ entra, − sai) além da cor; leitores de tela ouvem "entrada" ou "saída". */
export function SignedMoney({ cents, className }: { cents: number; className?: string }) {
  return (
    <span
      className={cx(
        "tabular whitespace-nowrap font-semibold",
        cents > 0 && "text-emerald-700 dark:text-emerald-400",
        cents < 0 && "text-red-700 dark:text-red-300",
        className,
      )}
    >
      <span className="sr-only">{cents > 0 ? "entrada de " : cents < 0 ? "saída de " : ""}</span>
      <span aria-hidden>{signOf(cents)}</span>
      {signOf(cents) && " "}
      <Money cents={Math.abs(cents)} />
    </span>
  );
}

/** Erro do back-end com o próximo passo logo abaixo. */
export function CashError({ error }: { error: unknown }) {
  if (!error) return null;
  const hint = cashErrorHint(error);
  return (
    <div className="space-y-1">
      <ErrorBox error={error} />
      {hint && <p className="text-xs text-slate-600 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * Botão de enviar + Cancelar. Com `problem`, o botão fica desabilitado e o motivo aparece ao lado (e é lido
 * junto com o botão), para a pessoa nunca ficar sem saber por que não dá para continuar.
 */
export function SubmitRow({
  label,
  problem,
  pending,
  onCancel,
  pendingLabel = "Salvando...",
}: {
  label: string;
  problem: string | null;
  pending: boolean;
  onCancel?: () => void;
  pendingLabel?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={problem !== null || pending} aria-describedby={problem ? id : undefined}>
          {pending ? pendingLabel : label}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
      {problem && (
        <p id={id} className="text-xs text-slate-600 dark:text-slate-400">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * Moldura dos formulários do caixa: título curto, explicação e os campos. Ao abrir, o foco vai para o
 * primeiro campo (`autoFocus`), para quem usa teclado ou leitor de tela começar a digitar direto.
 */
export function FormPanel({
  title,
  intro,
  onSubmit,
  children,
  autoFocus = true,
}: {
  title: string;
  intro?: ReactNode;
  onSubmit: () => void;
  children: ReactNode;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.querySelector<HTMLElement>('input:not([type="checkbox"]):not([disabled]), select:not([disabled])')?.focus();
  }, [autoFocus]);

  return (
    <form
      ref={ref}
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/30"
    >
      <div>
        <h3 className="font-serif text-base font-semibold">{title}</h3>
        {intro && <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">{intro}</div>}
      </div>
      {children}
    </form>
  );
}

/** "Caixa de hoje: de R$ A para R$ B" — a conta explicada antes de confirmar. */
export function BalancePreview({ label = "Caixa de hoje", before, after }: { label?: string; before: number; after: number }) {
  return (
    <p className="text-sm text-slate-700 dark:text-slate-300">
      {label}: de <Money cents={before} /> para <strong><Money cents={after} /></strong>
    </p>
  );
}
