/** Geometria da rosca de pontas arredondadas. Ângulos em radianos a partir das 12h, no sentido horário. */

export interface RingArc {
  key: string;
  /** Caminho SVG do traço (arco), já recuado para as pontas arredondadas não se tocarem. */
  d: string;
}

const TAU = Math.PI * 2;
const f = (n: number) => Number(n.toFixed(3));

function point(radius: number, angle: number, center: number) {
  return { x: center + radius * Math.sin(angle), y: center - radius * Math.cos(angle) };
}

/**
 * Um arco por fatia. Com `stroke-linecap: round` a ponta se estende meia espessura além do arco, então cada
 * lado recua essa folga mais a lacuna desejada. Fatia fina demais para sobrar arco vira um ponto (arco de
 * comprimento zero), que a ponta arredondada desenha como círculo: ela continua visível e clicável.
 */
export function ringArcs(
  slices: readonly { key: string; value: number }[],
  { size, thickness, gap = 5 }: { size: number; thickness: number; gap?: number },
): RingArc[] {
  const center = size / 2;
  const radius = (size - thickness) / 2;
  const total = slices.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  if (total <= 0 || radius <= 0) return [];

  // Recuo por lado, em radianos: meia espessura (a ponta) + metade da lacuna.
  const inset = (thickness / 2 + gap / 2) / radius;
  const arcs: RingArc[] = [];
  let cursor = 0;
  for (const slice of slices) {
    const value = Math.max(slice.value, 0);
    if (value === 0) continue;
    const sweep = (value / total) * TAU;
    const start = cursor + inset;
    const end = cursor + sweep - inset;
    cursor += sweep;

    // Uma fatia só ocupa a volta toda: um único arco degenera, então desenha duas metades.
    if (slices.filter((s) => s.value > 0).length === 1) {
      const top = point(radius, 0, center);
      const bottom = point(radius, Math.PI, center);
      arcs.push({
        key: slice.key,
        d: `M ${f(top.x)} ${f(top.y)} A ${f(radius)} ${f(radius)} 0 1 1 ${f(bottom.x)} ${f(bottom.y)} A ${f(radius)} ${f(radius)} 0 1 1 ${f(top.x)} ${f(top.y)}`,
      });
      continue;
    }

    if (end <= start) {
      const mid = point(radius, cursor - sweep / 2, center);
      arcs.push({ key: slice.key, d: `M ${f(mid.x)} ${f(mid.y)} L ${f(mid.x)} ${f(mid.y)}` });
      continue;
    }
    const a = point(radius, start, center);
    const b = point(radius, end, center);
    const large = end - start > Math.PI ? 1 : 0;
    arcs.push({ key: slice.key, d: `M ${f(a.x)} ${f(a.y)} A ${f(radius)} ${f(radius)} 0 ${large} 1 ${f(b.x)} ${f(b.y)}` });
  }
  return arcs;
}
