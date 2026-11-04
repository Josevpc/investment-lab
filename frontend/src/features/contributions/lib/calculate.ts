/** Aporte = salário x percentual, arredondado meio para cima ao centavo (espelha o back-end). */
export function calculateContribution(salaryCents: number, percentBps: number): number {
  return Math.floor((salaryCents * percentBps + 5000) / 10_000);
}
