import { formatDayMonth } from "@/shared/lib/format";
import { Money } from "@/shared/ui";

/**
 * O quanto o patrimônio valorizou (ou recuou) desde a primeira data com saldo na janela. A data vem escrita porque
 * a medição nem sempre cobre 30 dias inteiros. O recuo usa o tom argila suave: é informação, não alarme, e nunca jade.
 */
export function AppreciationPill({ cents, since }: { cents: number; since: string }) {
  const up = cents >= 0;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-ink ${up ? "bg-jade-t" : "bg-clay-t"}`}>
      <span aria-hidden className={up ? "text-jade" : undefined}>
        {up ? "▲" : "▼"}
      </span>
      <span>
        {up ? (
          <>
            <Money cents={cents} /> de valorização desde {formatDayMonth(since)}
          </>
        ) : (
          <>
            Recuo de <Money cents={-cents} /> desde {formatDayMonth(since)}
          </>
        )}
      </span>
    </span>
  );
}
