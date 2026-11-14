/**
 * Alíquotas da tabela regressiva do IR da renda fixa. A pessoa escolhe uma para comparar ativos isentos e tributados;
 * o app não calcula o imposto devido (isso depende do prazo de cada aplicação).
 */
export const IR_RATES = [
  { bps: 2250, hint: "aplicações de até 180 dias" },
  { bps: 2000, hint: "de 181 a 360 dias" },
  { bps: 1750, hint: "de 361 a 720 dias" },
  { bps: 1500, hint: "acima de 720 dias" },
] as const;

/** A menor alíquota: a que vale para quem deixa o dinheiro aplicado por mais tempo. */
export const DEFAULT_IR_RATE_BPS = 1500;

/** Chave no navegador; a escolha vale só neste computador e não vai para o banco. */
export const IR_RATE_KEY = "il-ir-rate";

export function isIrRate(bps: number): boolean {
  return IR_RATES.some((rate) => rate.bps === bps);
}

/** Valor guardado no navegador, ou o padrão se não houver nada válido (vazio, lixo, alíquota que não existe). */
export function parseIrRate(raw: string | null): number {
  const bps = raw === null || !/^\d+$/.test(raw) ? NaN : Number(raw);
  return isIrRate(bps) ? bps : DEFAULT_IR_RATE_BPS;
}
