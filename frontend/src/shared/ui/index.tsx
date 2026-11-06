import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useModalBehavior } from "./Dialog";
import { PebbleBar } from "./PebbleBar";
import { Button, cx } from "./primitives";
import { useScrollEdges } from "./scrollEdges";

/** Campo sem borda: fundo `raise`, raio de 16px; o foco é o anel mel global (index.css). */
export const inputClass =
  "w-full rounded-field bg-raise px-4 py-3 text-base text-ink placeholder:text-ink-3 " +
  "disabled:opacity-50 aria-[invalid=true]:bg-clay-t";

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rise rounded-card bg-card p-5 shadow-soft sm:p-7", className)}>
      {(title || action) && (
        <header className="mb-5 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-serif text-xl sm:text-section">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-3xl sm:text-title">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-base text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  /** Texto ou partes (com <Money>, para respeitar "ocultar valores"). */
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block text-sm", className)}>
      <span className="mb-1.5 block font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-sm text-clay">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>
      )}
    </label>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex gap-3 rounded-field bg-clay-t px-4 py-3 text-sm text-ink">
      <span aria-hidden className="mt-0.5 font-semibold text-clay">
        !
      </span>
      <span>{message}</span>
    </div>
  );
}

export type NoticeTone = "info" | "attention" | "warn" | "success";

/** Classes do aviso, sem borda: o tom suave do fundo e o texto escrito carregam o sentido. "attention" (mel) pede atenção sem parecer erro; "warn" (argila) é para o que deu errado. */
export function noticeClass(tone: NoticeTone = "info") {
  return cx(
    // Caminhos de pasta e nomes de arquivo não têm espaços: sem isso, empurram a página para os lados no celular.
    "rounded-field px-4 py-3 text-sm text-ink [overflow-wrap:anywhere]",
    tone === "warn" && "bg-clay-t",
    tone === "success" && "bg-jade-t",
    tone === "attention" && "bg-gold-t",
    tone === "info" && "bg-raise text-ink-2",
  );
}

/** `role="status"` anuncia o aviso a leitores de tela quando ele aparece depois de uma ação (ex.: "Grupo criado"). */
export function Notice({ tone = "info", role, children }: { tone?: NoticeTone; role?: "status" | "alert"; children: ReactNode }) {
  return (
    <p role={role} className={noticeClass(tone)}>
      {children}
    </p>
  );
}

/** Esqueleto estático (sem pulsar): formas suaves no lugar do conteúdo e o texto de status para leitores de tela. */
export function Loading({ label = "Carregando..." }: { label?: string }) {
  return (
    <div role="status" className="py-6">
      <div aria-hidden className="space-y-3">
        <div className="h-4 w-2/5 rounded-full bg-raise" />
        <div className="h-4 w-full rounded-full bg-raise" />
        <div className="h-4 w-3/5 rounded-full bg-raise" />
      </div>
      <p className="mt-4 text-sm text-ink-3">{label}</p>
    </div>
  );
}

/** Estado vazio: um broto, o texto que explica o que fazer e, se houver, a ação. Sem caixa tracejada. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <Sprout />
      <p className="max-w-md text-sm text-ink-2">{children}</p>
      {action}
    </div>
  );
}

function Sprout() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-12 text-jade" fill="none">
      <ellipse cx="24" cy="41" rx="12" ry="3" className="fill-raise" />
      <path d="M24 40V22" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 26C16 26 11 21 10 13c8 0 13 4 14 13Z" className="fill-jade-t" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M24 22c0-7 4-11 12-12 0 7-4 12-12 12Z" className="fill-jade-t" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "good" | "bad";
  hint?: ReactNode;
}) {
  return (
    // min-w-0 e letra menor no celular: em 360 px, dois valores como "R$ 182.816,14" lado a lado se sobrepunham.
    <div className="min-w-0">
      <p className="text-sm font-medium text-ink-3">{label}</p>
      <p
        className={cx(
          "tabular mt-1 break-words font-serif text-xl sm:text-2xl",
          tone === "good" && "text-jade",
          tone === "bad" && "text-clay",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

/** Grupo de botões exclusivos (modo de divisão, período, escopo...). O ativo é tinta sólida nos dois temas. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "sm",
  grid = false,
  fill = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** No celular, as opções viram uma grade de duas colunas (para 4 opções não quebrarem pela metade). */
  grid?: boolean;
  /** No celular, ocupa a largura toda numa linha só e as opções dividem o espaço (para 3 ou 4 opções curtas). */
  fill?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "max-w-full gap-1 rounded-full bg-raise p-1",
        grid
          ? "grid w-full grid-cols-2 sm:inline-flex sm:w-auto"
          : fill
            ? "flex w-full sm:inline-flex sm:w-auto"
            : "inline-flex flex-wrap",
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            "min-h-10 rounded-full font-medium transition-colors duration-150",
            fill && "flex-1 px-2 sm:flex-none",
            size === "sm" ? (fill ? "text-sm sm:px-4" : "px-4 text-sm") : fill ? "text-base sm:px-5" : "px-5 text-base",
            value === option.value ? "bg-ink text-card" : "text-ink-2 hover:bg-soil",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Abas de uma tela (Patrimônio, Composição, Desempenho...). Setas, Home e End movem entre as abas. */
export function Tabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: T;
  tabs: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  // No celular as abas podem não caber: a borda com mais abas esmaece, e a aba ativa rola para a vista.
  const edges = useScrollEdges<HTMLDivElement>();

  // Sem isto, escolher uma aba que está fora da vista (ou chegar nela pelas setas) a deixaria escondida.
  // Move só a faixa (não a página nem a gaveta), com folga para o esmaecimento da borda.
  useEffect(() => {
    const list = edges.ref.current;
    const active = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !active) return;
    const bar = list.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    const margin = 32;
    if (tab.left < bar.left + margin) list.scrollLeft = Math.max(0, list.scrollLeft + tab.left - bar.left - margin);
    else if (tab.right > bar.right - margin) list.scrollLeft += tab.right - bar.right + margin;
  }, [value, edges.ref]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.value === value);
    const next =
      event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].value);
    document.getElementById(`tab-${tabs[next].value}`)?.focus();
  }

  return (
    <div
      ref={edges.ref}
      style={edges.style}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-raise p-1"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          id={`tab-${tab.value}`}
          tabIndex={value === tab.value ? 0 : -1}
          aria-selected={value === tab.value}
          aria-controls={`panel-${tab.value}`}
          onClick={() => onChange(tab.value)}
          className={cx(
            "min-h-10 shrink-0 rounded-full px-4 text-sm font-medium transition-colors duration-150 sm:px-5",
            value === tab.value ? "bg-ink text-card" : "text-ink-2 hover:bg-soil",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Barra de participação (a barra "seixo" do produto) com marcador de meta. O valor vem escrito ao lado, por quem a usa. */
export function ShareBar({
  valueBps,
  targetBps,
  color,
  label,
}: {
  valueBps: number;
  targetBps?: number;
  color: string;
  label: string;
}) {
  return <PebbleBar role="img" valueBps={valueBps} targetBps={targetBps} color={color} label={label} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "gold" | "warn" | "good" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-ink",
        tone === "neutral" && "bg-raise",
        tone === "gold" && "bg-gold-t",
        tone === "warn" && "bg-clay-t",
        tone === "good" && "bg-jade-t",
      )}
    >
      {children}
    </span>
  );
}

/** Painel lateral sobre a tela: detalhe de ativo, edição de plano... Esc fecha; o foco fica preso nele e volta ao fechar. */
export function Drawer({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  useModalBehavior(panel, onClose);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Fechar painel"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--scrim)]"
      />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          "rise relative flex h-full w-full flex-col overflow-y-auto rounded-l-card bg-ground p-5 shadow-soft sm:p-7",
          wide ? "max-w-3xl" : "max-w-xl",
        )}
      >
        <header className="mb-5 flex items-center justify-between gap-3">
          <h2 className="font-serif text-xl sm:text-section">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar">
            Fechar
          </Button>
        </header>
        {children}
      </aside>
    </div>
  );
}

export { MonthInput } from "./MonthInput";
export { Switch } from "./Switch";
export { NewAssetsNote } from "./NewAssetsNote";
export { ScrollRegion } from "./ScrollRegion";
export { ConfirmDialog, Dialog, splitQuestion, useConfirm } from "./Dialog";
export { Button, buttonClass, ButtonLink, cx, Money } from "./primitives";
