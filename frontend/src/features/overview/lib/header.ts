import type { RangeKey } from "@/features/history";

/** "sábado, 1 de novembro de 2026". Usa a data local do aparelho (não passa por ISO, que deslocaria o dia). */
export function longDate(now = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
}

/** "Olá, José"; sem nome, só "Olá". */
export function hello(name = ""): string {
  const who = name.trim();
  return who ? `Olá, ${who}` : "Olá";
}

/** Título do gráfico de evolução, dizendo o período escolhido. */
export function evolutionTitle(range: RangeKey): string {
  switch (range) {
    case "6m":
      return "Evolução nos últimos 6 meses";
    case "12m":
      return "Evolução nos últimos 12 meses";
    case "5y":
      return "Evolução nos últimos 5 anos";
    case "all":
      return "Evolução em todo o período";
  }
}

/** "AAAA-MM-DD" menos `days` dias, sem passar por fuso. */
export function daysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
