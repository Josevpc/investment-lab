import { cx } from "./primitives";
import { PebbleBar } from "./PebbleBar";

const MARKS = [2_500, 5_000, 7_500, 10_000] as const;
const CIRCLE_MARKS = [2_500, 5_000, 7_500] as const;

/**
 * Barra de progresso de uma meta, em jade. Os marcos de 25, 50, 75 e 100% ficam escritos,
 * então a cor não é o único sinal. Com `markers`, 25/50/75% também viram círculos sobre a barra
 * (mel quando alcançados) e os rótulos ficam alinhados embaixo deles.
 */
export function GoalBar({ bps, label, markers = false }: { bps: number; label: string; markers?: boolean }) {
  return (
    <div>
      <PebbleBar role="progressbar" valueBps={bps} label={label} marks={markers ? CIRCLE_MARKS : undefined} />
      <ul
        className={cx("mt-2 text-xs text-ink-3", markers ? "relative h-5" : "flex justify-between")}
        aria-label="Marcos da meta"
      >
        {MARKS.map((mark) => {
          const done = bps >= mark;
          return (
            <li
              key={mark}
              className={cx(
                "tabular",
                done && "font-semibold text-ink",
                markers && "absolute top-0 whitespace-nowrap",
                markers && mark === 10_000 ? "right-0" : markers && "-translate-x-1/2",
              )}
              style={markers && mark !== 10_000 ? { left: `${mark / 100}%` } : undefined}
            >
              {done ? "✓ " : ""}
              {mark / 100}%
            </li>
          );
        })}
      </ul>
    </div>
  );
}
