/** Lógica pura de edição das metas de alocação. Percentuais em pontos-base (1% = 100). */

export const TOTAL_BPS = 10_000;
export const STEP_BPS = 50; // passo de 0,5 p.p. ao arrastar

export type Targets = Record<string, number>; // class_key -> bps

/** Reparte `total` (inteiro) na proporção de `weights`, sem perder unidades (maiores restos). */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const effective = sum > 0 ? weights : weights.map(() => 1);
  const effectiveSum = sum > 0 ? sum : weights.length;

  const exact = effective.map((w) => (total * w) / effectiveSum);
  const result = exact.map(Math.floor);
  let leftover = total - result.reduce((a, b) => a + b, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value), weight: effective[index] }))
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index);
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    result[index] += 1;
    leftover -= 1;
  }
  return result;
}

/** Define a meta de `key` e reajusta as demais proporcionalmente, preservando as travadas. */
export function redistribute(
  values: Targets,
  key: string,
  nextBps: number,
  locked: ReadonlySet<string> = new Set(),
): Targets {
  if (locked.has(key)) return values;

  const others = Object.keys(values).filter((k) => k !== key);
  const lockedSum = others.filter((k) => locked.has(k)).reduce((sum, k) => sum + values[k], 0);
  const free = others.filter((k) => !locked.has(k));

  const ceiling = TOTAL_BPS - lockedSum;
  let next = Math.min(Math.max(Math.round(nextBps), 0), ceiling);
  // Sem classes livres para absorver a diferença, esta recebe todo o restante.
  if (free.length === 0) next = ceiling;

  const remaining = ceiling - next;
  const shares = allocate(
    remaining,
    free.map((k) => values[k]),
  );

  const result: Targets = { ...values, [key]: next };
  free.forEach((k, i) => {
    result[k] = shares[i];
  });
  return result;
}

/**
 * Move a fronteira entre `order[index]` e `order[index + 1]` (arrasto no gráfico).
 * Só essas duas fatias mudam; a soma delas é constante. `cumulativeBps` é a nova posição da
 * fronteira, medida desde o início da rosca.
 */
export function moveBoundary(
  values: Targets,
  order: string[],
  index: number,
  cumulativeBps: number,
  locked: ReadonlySet<string> = new Set(),
): Targets {
  const a = order[index];
  const b = order[index + 1];
  if (a === undefined || b === undefined || locked.has(a) || locked.has(b)) return values;

  const before = order.slice(0, index).reduce((sum, k) => sum + values[k], 0);
  const pair = values[a] + values[b];
  const snapped = Math.round((cumulativeBps - before) / STEP_BPS) * STEP_BPS;
  const nextA = Math.min(Math.max(snapped, 0), pair);
  if (nextA === values[a]) return values;
  return { ...values, [a]: nextA, [b]: pair - nextA };
}

/**
 * Prévia local da divisão proporcional (espelha `split_by_weights` do back-end). É só prévia: pode
 * diferir 1 centavo do valor oficial por arredondamento; quem vale é a divisão da tela de aporte.
 */
export function splitProportional(amountCents: number, targets: Targets): Record<string, number> {
  const keys = Object.keys(targets);
  if (keys.length === 0) return {};
  // Metas todas em 0: o back-end divide por igual, e a prévia também.
  const weights = keys.map((k) => targets[k]);
  if (weights.every((w) => w <= 0)) weights.fill(1);
  const sum = weights.reduce((a, b) => a + b, 0);

  const parts = weights.map((w) => Math.floor((amountCents * w) / sum));
  const remainder = amountCents - parts.reduce((a, b) => a + b, 0);
  if (remainder > 0) {
    parts[weights.indexOf(Math.max(...weights))] += remainder; // a sobra vai para a maior fatia
  }
  return Object.fromEntries(keys.map((k, i) => [k, parts[i]]));
}

export function totalOf(values: Targets): number {
  return Object.values(values).reduce((a, b) => a + b, 0);
}
