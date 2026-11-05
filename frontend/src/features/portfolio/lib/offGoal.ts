import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { Movement } from "../types";

// "Fora da meta do mês": o aporte continua no investido, no patrimônio e na rentabilidade, mas não conta no plano
// do mês, no "extra", no "o que falta" nem na sequência. Caso típico: a sobra do mês que foi para a reserva.

export const OFF_GOAL_LABEL = "Fora da meta do mês";

export const OFF_GOAL_HELP =
  "Conta no investido, no patrimônio e na rentabilidade, mas não no plano do mês, na sequência nem no ritmo de aporte.";

/** O rótulo do botão da linha: a ação que ele faz, não o estado. */
export function offGoalActionLabel(m: Pick<Movement, "off_goal">): string {
  return m.off_goal ? "Contar na meta" : "Tirar da meta";
}

/** Confirmação depois de marcar ou desmarcar: o que foi feito e o que muda a seguir. */
export function offGoalDone(m: Pick<Movement, "asset_name" | "amount_cents">, nowOffGoal: boolean): MoneyTextPart[] {
  const head: MoneyTextPart[] = ["Aporte de ", { cents: m.amount_cents }, ` em ${m.asset_name} `];
  return nowOffGoal
    ? [...head, "marcado como fora da meta. Ele continua no investido; o plano do mês e a sequência deixam de contá-lo."]
    : [...head, "voltou a contar na meta. O plano do mês e a sequência passam a contá-lo de novo."];
}

/** Frase extra da confirmação do aporte quando parte dele foi marcada como fora da meta; vazia quando nada foi. */
export function offGoalSavedNote(items: { contribution_cents: number; off_goal?: boolean }[]): string {
  const marked = items.some((i) => i.off_goal && i.contribution_cents > 0);
  return marked ? " Marcado como fora da meta do mês: não conta no plano nem na sequência." : "";
}

/** Só o aporte pode ficar fora da meta. */
export function canBeOffGoal(m: Pick<Movement, "kind">): boolean {
  return m.kind === "aporte";
}
