import { formatPercent } from "@/shared/lib/format";
import { cx, Money } from "@/shared/ui";
import { adjustedTargetNote, targetShareOfPortfolio } from "../lib/comparison";
import type { Comparison, ComparisonGroup, ComparisonItem } from "../types";

/**
 * Conteúdo da coluna "Meta": a meta valendo agora e, se ela foi ajustada, de quanto era (a explicação
 * completa fica em `AdjustedTargetNotes`, abaixo da tabela, para a coluna caber no celular). Na
 * categoria toda mantida, diz em texto que a meta está suspensa e qual era a do plano.
 */
export function TargetMeta({ item }: { item: ComparisonItem }) {
  // O selo "Mantida: meta suspensa" fica junto do nome da categoria (cabe melhor no celular).
  if (item.hold_status === "all") {
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400">
        suspensa
        <span className="block">plano: {formatPercent(item.target_bps)}</span>
      </span>
    );
  }
  return (
    <>
      {formatPercent(item.effective_target_bps)}
      {item.effective_target_bps !== item.target_bps && (
        <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
          ajustada*, era {formatPercent(item.target_bps)}
        </span>
      )}
    </>
  );
}

/**
 * Explicação das metas ajustadas, uma linha por categoria: "meta 50%, ajustada para 71,43% porque X
 * está toda mantida (equivale a 50% da carteira toda)". Some quando nenhuma meta mudou.
 */
export function AdjustedTargetNotes({ comparison, className }: { comparison: Comparison; className?: string }) {
  const notes = comparison.items.flatMap((item) => {
    const note = adjustedTargetNote(item, comparison.items);
    if (!note) return [];
    const ofPortfolio = targetShareOfPortfolio(item, comparison);
    const equivalent =
      ofPortfolio !== null && ofPortfolio !== item.effective_target_bps ? ` (equivale a ${formatPercent(ofPortfolio)} da carteira toda)` : "";
    return [{ key: item.class_key, text: `${item.class_name}: ${note}${equivalent}.` }];
  });
  if (notes.length === 0) return null;
  return (
    <ul className={cx("space-y-0.5 text-sm text-ink-3", className)}>
      {notes.map((n, i) => (
        <li key={n.key}>
          {i === 0 && <span aria-hidden>* </span>}
          {n.text}
        </li>
      ))}
    </ul>
  );
}

/** Coluna "Falta/sobra (R$)": quanto falta (abaixo da meta) ou sobra (acima), em reais e por extenso. */
export function TargetGap({ item, className }: { item: Pick<ComparisonItem, "hold_status" | "diff_cents">; className?: string }) {
  const diff = item.diff_cents;
  if (item.hold_status === "all" || diff === null) {
    return (
      <span className={cx("text-slate-500 dark:text-slate-400", className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">meta suspensa</span>
      </span>
    );
  }
  if (diff === 0) return <span className={className}>na meta</span>;
  return (
    <span
      className={cx(
        diff > 0 ? "text-clay" : "text-gold",
        className,
      )}
    >
      {diff > 0 ? "sobra " : "falta "}
      <Money cents={Math.abs(diff)} className="whitespace-nowrap" />
    </span>
  );
}

/**
 * Meta do grupo: a soma das metas das categorias dele (o grupo não tem meta própria nem campo para
 * editá-la). Se alguma categoria está toda mantida, a soma efetiva difere da gravada e as duas aparecem.
 */
export function GroupTargetMeta({ group }: { group: Pick<ComparisonGroup, "hold_status" | "target_bps" | "effective_target_bps"> }) {
  if (group.hold_status === "all") {
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400">
        suspensa
        <span className="block">soma no plano: {formatPercent(group.target_bps)}</span>
      </span>
    );
  }
  return (
    <>
      {/* A coluna é estreita: o rótulo completo fica no title e para leitores de tela. */}
      <span title="Soma das metas das categorias do grupo">
        {formatPercent(group.effective_target_bps)}
        <span className="sr-only"> soma das metas das categorias</span>
      </span>
      {group.effective_target_bps !== group.target_bps && (
        <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">soma no plano: {formatPercent(group.target_bps)}</span>
      )}
    </>
  );
}
