import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatPercent } from "@/shared/lib/format";
import { angleFromPoint, angleToBps, arcPath, bpsToAngle, buildSlices, polar } from "../lib/donut";
import { moveBoundary, STEP_BPS, type Targets } from "../lib/targets";
import type { AllocationClass } from "../types";

const SIZE = 240;
const CENTER = SIZE / 2;
const R_OUTER = 104;
const R_INNER = 64;
const R_HANDLE = (R_OUTER + R_INNER) / 2;
const CORNER = 6; // raio dos cantos de cada fatia
const GAP = 3; // vão entre fatias, no meio do anel
const INSET = (CORNER + GAP / 2) / R_HANDLE; // recuo em radianos de cada lado da fatia
const MIN_HALF_SWEEP = 0.012; // fatias minúsculas continuam visíveis

interface DonutProps {
  classes: AllocationClass[];
  values: Targets;
  /** Se informado, as fronteiras entre fatias podem ser arrastadas. */
  onChange?: (next: Targets) => void;
  locked?: ReadonlySet<string>;
  centerTop?: string;
  centerBottom?: string;
  /** O texto do centro é um valor em reais: "ocultar valores" o desfoca. */
  centerIsMoney?: boolean;
  className?: string;
}

export function Donut({ classes, values, onChange, locked, centerTop, centerBottom, centerIsMoney, className }: DonutProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const lastBps = useRef(0);
  const [dragging, setDragging] = useState<number | null>(null);

  const order = classes.map((c) => c.key);
  const slices = buildSlices(order, values);
  const alone = slices.filter((s) => s.bps > 0).length === 1; // anel inteiro, sem vão
  const editable = Boolean(onChange);
  const lockedSet = locked ?? new Set<string>();

  function pointerToBps(event: PointerEvent<SVGElement>): number | null {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return angleToBps(angleFromPoint(CENTER, CENTER, local.x, local.y));
  }

  function handlePointerMove(event: PointerEvent<SVGElement>, index: number) {
    if (dragging !== index || !onChange) return;
    const bps = pointerToBps(event);
    if (bps === null) return;
    // Ignora o salto de ~100% para ~0% ao cruzar as 12h: a primeira fronteira é fixa.
    if (Math.abs(bps - lastBps.current) > 5000) return;
    lastBps.current = bps;
    const next = moveBoundary(values, order, index, bps, lockedSet);
    if (next !== values) onChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<SVGElement>, index: number) {
    if (!onChange) return;
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? STEP_BPS
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -STEP_BPS
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = moveBoundary(values, order, index, slices[index].endBps + delta, lockedSet);
    if (next !== values) onChange(next);
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={className}
      // Com alças (role="slider") dentro, "img" as esconderia dos leitores de tela: vira um grupo nomeado.
      role={editable ? "group" : "img"}
      aria-label={`Alocação: ${slices.map((s, i) => `${classes[i].name} ${formatPercent(s.bps)}`).join(", ")}`}
    >
      {slices.map((slice, i) => {
        // Pontas arredondadas: o setor encolhe CORNER px por dentro e o traço da mesma cor, com junção redonda,
        // devolve o tamanho com os cantos curvos. O vão entre fatias vem do recuo em ângulo.
        const start = bpsToAngle(slice.startBps);
        const end = bpsToAngle(slice.endBps);
        const mid = (start + end) / 2;
        const room = (end - start) / 2 - (alone ? 0 : INSET);
        const half = Math.max(room, MIN_HALF_SWEEP);
        return (
          <path
            key={slice.key}
            d={arcPath(CENTER, CENTER, R_OUTER - CORNER, R_INNER + CORNER, alone ? start : mid - half, alone ? end : mid + half)}
            fill={classes[i].color}
            fillRule="evenodd"
            stroke={classes[i].color}
            strokeWidth={CORNER * 2}
            strokeLinejoin="round"
          >
            <title>{`${classes[i].name}: ${formatPercent(slice.bps)}`}</title>
          </path>
        );
      })}

      {editable &&
        slices.slice(0, -1).map((slice, i) => {
          const disabled = lockedSet.has(order[i]) || lockedSet.has(order[i + 1]);
          const position = polar(CENTER, CENTER, R_HANDLE, bpsToAngle(slice.endBps));
          return (
            <circle
              key={`handle-${slice.key}`}
              cx={position.x}
              cy={position.y}
              r={dragging === i ? 9 : 7}
              tabIndex={disabled ? -1 : 0}
              role="slider"
              aria-label={`Divisão entre ${classes[i].name} e ${classes[i + 1].name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={slice.endBps / 100}
              aria-valuetext={`${classes[i].name} ${formatPercent(slice.bps)}`}
              aria-disabled={disabled}
              className={
                "fill-card stroke-ink outline-none focus-visible:stroke-gold " +
                (disabled ? "opacity-30" : "cursor-grab active:cursor-grabbing")
              }
              strokeWidth={2.5}
              style={{ touchAction: "none" }}
              onPointerDown={(event) => {
                if (disabled) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                lastBps.current = slice.endBps;
                setDragging(i);
              }}
              onPointerMove={(event) => handlePointerMove(event, i)}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
              onKeyDown={(event) => handleKeyDown(event, i)}
            />
          );
        })}

      <g textAnchor="middle" className="pointer-events-none fill-ink">
        <text x={CENTER} y={CENTER + (centerBottom ? -2 : 8)} fontSize={centerBottom ? 21 : 26} className={centerIsMoney ? "tabular money font-serif" : "font-serif"}>
          {centerTop ?? "100%"}
        </text>
        {centerBottom && (
          <text x={CENTER} y={CENTER + 19} fontSize={15} className="fill-ink-3">
            {centerBottom}
          </text>
        )}
      </g>
    </svg>
  );
}
