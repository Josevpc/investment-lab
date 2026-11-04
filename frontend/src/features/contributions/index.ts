// Interface pública da feature de aportes (consumida por outras features).
// As páginas ficam fora do index, e o roteador importa direto delas, para evitar ciclos.
export { useContributions } from "./hooks";
export { planProgress } from "./lib/planProgress";
export type { PlanProgress, PlanRow } from "./lib/planProgress";
export type { Contribution } from "./types";
