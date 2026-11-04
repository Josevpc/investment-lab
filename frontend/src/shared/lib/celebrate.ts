// Comemoração de conquistas (aporte, provento, ativo novo, mês fechado). Qualquer feature dispara
// `celebrate`; o `CelebrationHost` (shared/ui) mostra. Sem estado global além de uma fila de ouvintes.

export interface Celebration {
  title: string;
  /** O que foi feito, em uma frase. */
  text: string;
  /** Uma linha extra com número de destaque (ex.: a sequência de meses). */
  highlight?: string;
  /** O que vem a seguir; com `to`, vira um link. */
  next?: { label: string; to?: string };
}

export interface ActiveCelebration extends Celebration {
  id: number;
}

type Listener = (celebration: ActiveCelebration) => void;

const listeners = new Set<Listener>();
let counter = 0;

export function celebrate(celebration: Celebration): void {
  counter += 1;
  const active = { ...celebration, id: counter };
  listeners.forEach((listener) => listener(active));
}

export function onCelebrate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
