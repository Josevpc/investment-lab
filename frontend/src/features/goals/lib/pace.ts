import type { ContributionPace } from "../types";

// "Agora não" na sugestão de aumentar a meta vale para aquele valor: se o ritmo mudar e a sugestão
// for outra, ela volta. A demonstração guarda à parte, para os dados fictícios não esconderem a real.
export const PACE_DISMISSED_KEY = "il-pace-dismissed";
export const PACE_DISMISSED_DEMO_KEY = "il-pace-dismissed-demo";

export function readDismissed(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isInteger(value) ? value : null;
  } catch {
    return null; // armazenamento indisponível: a sugestão simplesmente volta a aparecer
  }
}

export function writeDismissed(key: string, cents: number): void {
  try {
    localStorage.setItem(key, String(cents));
  } catch {
    // Sem armazenamento: esconde só enquanto a tela estiver aberta (estado do componente).
  }
}

/** A sugestão só aparece com meta definida (meta 0 é automático) e se não foi dispensada para esse valor. */
export function visibleSuggestion(pace: ContributionPace, dismissedCents: number | null) {
  const s = pace.suggestion;
  if (!s || pace.goal_cents <= 0 || s.suggested_cents <= pace.goal_cents) return null;
  return s.suggested_cents === dismissedCents ? null : s;
}

export function hasAnyPace(pace: ContributionPace): boolean {
  return pace.windows.some((w) => w.average_cents !== null && w.months_with_data > 0);
}
