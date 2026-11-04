import { cx, Money } from "@/shared/ui";

/**
 * Um ganho com sinal escrito: ▲ em verde-jade quando rendeu, ▼ em tom neutro quando recuou.
 * O recuo não usa vermelho: oscilar faz parte, e a tela não deve soar como alarme.
 */
export function Earned({ cents, className }: { cents: number; className?: string }) {
  const up = cents >= 0;
  return (
    <span
      className={cx(
        "tabular whitespace-nowrap",
        up ? "text-jade" : "text-ink-2",
        className,
      )}
    >
      <span aria-hidden>{up ? "▲" : "▼"} </span>
      <span className="sr-only">{up ? "rendeu " : "recuou "}</span>
      <Money cents={Math.abs(cents)} />
    </span>
  );
}
