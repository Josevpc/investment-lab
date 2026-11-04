/** Geometria da rosca. Ângulos em radianos, a partir das 12h e no sentido horário. */

import { TOTAL_BPS, type Targets } from "./targets";

const TAU = Math.PI * 2;

export interface Slice {
  key: string;
  bps: number;
  startBps: number;
  endBps: number;
}

export function buildSlices(order: string[], values: Targets): Slice[] {
  let cursor = 0;
  return order.map((key) => {
    const slice = { key, bps: values[key] ?? 0, startBps: cursor, endBps: cursor + (values[key] ?? 0) };
    cursor = slice.endBps;
    return slice;
  });
}

export function bpsToAngle(bps: number): number {
  return (bps / TOTAL_BPS) * TAU;
}

export function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return { x: cx + radius * Math.sin(angle), y: cy - radius * Math.cos(angle) };
}

const f = (n: number) => Number(n.toFixed(3));

/** Caminho SVG de um setor de rosca entre os ângulos `a0` e `a1`. */
export function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const sweep = a1 - a0;
  if (sweep <= 0) return "";

  // Anel completo: um único arco degenera, então desenha duas metades.
  if (sweep >= TAU - 1e-6) {
    const top = polar(cx, cy, rOuter, 0);
    const bottom = polar(cx, cy, rOuter, Math.PI);
    const iTop = polar(cx, cy, rInner, 0);
    const iBottom = polar(cx, cy, rInner, Math.PI);
    return [
      `M ${f(top.x)} ${f(top.y)}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${f(bottom.x)} ${f(bottom.y)}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${f(top.x)} ${f(top.y)}`,
      `M ${f(iTop.x)} ${f(iTop.y)}`,
      `A ${rInner} ${rInner} 0 1 0 ${f(iBottom.x)} ${f(iBottom.y)}`,
      `A ${rInner} ${rInner} 0 1 0 ${f(iTop.x)} ${f(iTop.y)}`,
      "Z",
    ].join(" ");
  }

  const large = sweep > Math.PI ? 1 : 0;
  const p0 = polar(cx, cy, rOuter, a0);
  const p1 = polar(cx, cy, rOuter, a1);
  const q1 = polar(cx, cy, rInner, a1);
  const q0 = polar(cx, cy, rInner, a0);
  return [
    `M ${f(p0.x)} ${f(p0.y)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${f(p1.x)} ${f(p1.y)}`,
    `L ${f(q1.x)} ${f(q1.y)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${f(q0.x)} ${f(q0.y)}`,
    "Z",
  ].join(" ");
}

/** Ângulo (0..2π) de um ponto em relação ao centro, a partir das 12h no sentido horário. */
export function angleFromPoint(cx: number, cy: number, x: number, y: number): number {
  const angle = Math.atan2(x - cx, -(y - cy));
  return angle < 0 ? angle + TAU : angle;
}

export function angleToBps(angle: number): number {
  return (angle / TAU) * TOTAL_BPS;
}
