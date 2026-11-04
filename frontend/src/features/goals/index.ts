// Interface pública da feature de metas. A página fica fora daqui (o roteador a importa direto).
export { fetchGoalsProgress, useGoalsProgress } from "./hooks";
export { aporteHighlight, closingCelebration } from "./lib/goals";
export type { GoalsProgress } from "./types";
