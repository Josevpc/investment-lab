const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** 123456 -> "R$ 1.234,56" */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100);
}

/** Para eixos de gráfico: 1250000 -> "R$ 12,5 mil" */
export function formatBRLCompact(cents: number): string {
  return compact.format(cents / 100);
}

/** Pontos-base -> "7,5%" */
export function formatPercent(bps: number): string {
  return `${percent.format(bps / 100)}%`;
}

/** Pontos-base com sinal, para diferenças: "+3,5 p.p." */
export function formatPointsDiff(bps: number): string {
  const sign = bps > 0 ? "+" : "";
  return `${sign}${percent.format(bps / 100)} p.p.`;
}

/** "2026-10" -> "out/2026" */
export function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]}/${year}`;
}

/** Índice absoluto do mês ("2026-01" -> 2026*12), para achar meses vizinhos sem passar por Date. */
function monthIndex(month: string): number {
  const [year, m] = month.split("-");
  return Number(year) * 12 + Number(m) - 1;
}

/**
 * Lista de meses "YYYY-MM" (crescente) em texto curto: sequências de 3 ou mais viram faixa.
 * ["2026-01","2026-02","2026-03","2026-05"] -> "jan/2026 a mar/2026 e mai/2026".
 */
export function formatMonthList(months: readonly string[]): string {
  const runs: string[][] = [];
  for (const month of months) {
    const run = runs[runs.length - 1];
    if (run && monthIndex(month) === monthIndex(run[run.length - 1]) + 1) run.push(month);
    else runs.push([month]);
  }
  const parts = runs.flatMap((run) =>
    run.length >= 3 ? [`${formatMonth(run[0])} a ${formatMonth(run[run.length - 1])}`] : run.map(formatMonth),
  );
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** "2026-10-31" -> "31/10/2026" (sem passar por Date, que deslocaria o fuso). */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/** "2026-10-31T14:05:09" -> "31/10/2026 14:05" (campos lidos à mão: sem fuso, sem Date). */
export function formatDateTime(iso: string): string {
  return `${formatDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
}

/** Soma dias a "YYYY-MM-DD" sem sofrer com fuso nem horário de verão (a conta é feita em UTC). */
export function addDaysISO(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** "2026-10-31" -> "31/10". Para frases curtas em que o período recente dispensa o ano ("desde 02/10"). */
export function formatDayMonth(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

/** "2026-10-31" -> "31/10/26". Para eixos com várias datas no mesmo mês, onde "out/26" se repetiria. */
export function formatTickDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year.slice(2)}`;
}

/** "2026-10-31" -> "out/26" */
export function formatShortDate(iso: string): string {
  const [year, month] = iso.split("-");
  return `${MONTHS[Number(month) - 1]}/${year.slice(2)}`;
}

/** "2026-10" é um mês completo; "2026-1" (digitação pela metade) não é. */
export function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function todayISO(now = new Date()): string {
  return `${currentMonth(now)}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Converte texto digitado ("1.234,56", "1234.5", "R$ 800") em centavos.
 * Retorna null se o texto não for um valor monetário válido.
 */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[R$\s]/g, "");
  if (cleaned === "") return null;
  let normalized: string;
  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, ""); // "1.234" é milhar, não decimal
  } else {
    normalized = cleaned;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Converte "7,5" ou "7.5" (em %) para pontos-base (750). */
export function parsePercentToBps(input: string): number | null {
  const normalized = input.replace("%", "").replace(",", ".").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Centavos -> texto editável "1234,56". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function bpsToInput(bps: number): string {
  return String(bps / 100).replace(".", ",");
}

/** Pontos-base com sinal explícito: "+8,42%" ou "-1,5%". */
export function formatSignedPercent(bps: number): string {
  const sign = bps > 0 ? "+" : "";
  return `${sign}${percent.format(bps / 100)}%`;
}

/** "outubro de 2026" */
export function formatMonthLong(month: string): string {
  const [year, m] = month.split("-");
  const name = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(Number(year), Number(m) - 1, 1));
  return `${name} de ${year}`;
}

/** Só o nome do mês: "outubro". */
export function monthName(month: string): string {
  return formatMonthLong(month).split(" de ")[0];
}

export function greeting(now = new Date(), name = ""): string {
  const hour = now.getHours();
  const text = hour < 5 ? "Boa noite" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const who = name.trim();
  return who ? `${text}, ${who}` : text;
}
