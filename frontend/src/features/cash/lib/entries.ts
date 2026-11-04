import { ApiError } from "@/shared/lib/api";
import { formatBRL, formatDate } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { Account, Entry, EntryKind, ManualKind } from "../types";

export const KIND_LABEL: Record<EntryKind, string> = {
  saldo_inicial: "Saldo inicial",
  deposito: "Depósito",
  provento: "Provento",
  compra: "Compra",
  venda: "Venda",
  taxa: "Taxa",
  retirada: "Retirada",
  ajuste: "Ajuste",
  transferencia: "Transferência",
};

/** Sinal escrito do valor: a cor nunca é o único sinal de entrada ou saída. */
export function signOf(cents: number): "+" | "−" | "" {
  return cents > 0 ? "+" : cents < 0 ? "−" : "";
}

/** Nomes que o extrato precisa para descrever um lançamento (vêm da carteira e das contas). */
export interface EntryNames {
  asset: (id: number) => string | undefined;
  account: (id: number) => string | undefined;
}

/** De onde veio o dinheiro, em palavras: "Compra de HGLG11", "Para Conta XP"... */
export function describeEntry(entry: Entry, names: EntryNames): string {
  const asset = entry.asset_id === null ? undefined : (names.asset(entry.asset_id) ?? "ativo removido");
  const other = entry.counterpart_account_id === null ? "outra conta" : (names.account(entry.counterpart_account_id) ?? "outra conta");
  switch (entry.kind) {
    case "saldo_inicial":
      return "Caixa ativado: o controle começa aqui";
    case "deposito":
      if (entry.movement_id !== null && asset) return `Dinheiro novo do aporte em ${asset}`;
      if (asset) return `Dinheiro novo para a compra de ${asset}`;
      return "Dinheiro novo na conta";
    case "compra":
      return asset ? `Compra de ${asset}` : "Compra de ativo";
    case "venda":
      return asset ? `Venda de ${asset}` : "Venda de ativo";
    case "provento":
      return asset ? `Pago por ${asset}` : "Provento recebido";
    case "taxa":
      return "Taxa cobrada pela instituição";
    case "retirada":
      return "Dinheiro tirado da conta";
    case "ajuste":
      return entry.amount_cents > 0 ? "Correção: sobrava no caixa" : "Correção: faltava no caixa";
    case "transferencia":
      return entry.amount_cents < 0 ? `Para ${other}` : `De ${other}`;
  }
}

/** Por que um lançamento não tem "Excluir" e o que fazer no lugar. Null quando pode ser excluído. */
export function lockedReason(entry: Entry): string | null {
  if (entry.deletable) return null;
  if (entry.movement_id !== null) {
    return "Veio de um movimento da carteira. Para corrigir, edite ou desfaça o movimento em Movimentações.";
  }
  if (entry.kind === "saldo_inicial") return "O saldo inicial só pode ser excluído quando a conta não tem outros lançamentos.";
  return "Este lançamento não pode ser excluído aqui.";
}

/** Texto da confirmação de exclusão: diz o efeito no caixa e no capital aportado. */
export function deleteMessage(entry: Entry, accountName: string, names: EntryNames): string {
  const value = formatBRL(Math.abs(entry.amount_cents));
  const when = formatDate(entry.date);
  switch (entry.kind) {
    case "deposito":
      return `Excluir o depósito de ${value} de ${when}? O valor sai do caixa e do capital aportado de ${accountName}.`;
    case "retirada":
      return `Excluir a retirada de ${value} de ${when}? O valor volta ao caixa e ao capital aportado de ${accountName}.`;
    case "taxa":
      return `Excluir a taxa de ${value} de ${when}? O valor volta ao caixa de ${accountName}.`;
    case "ajuste":
      return `Excluir o ajuste de ${signOf(entry.amount_cents)}${value} de ${when}? O caixa de ${accountName} ${
        entry.amount_cents > 0 ? "diminui" : "aumenta"
      } ${value}.`;
    case "transferencia": {
      const other = entry.counterpart_account_id === null ? "a outra conta" : (names.account(entry.counterpart_account_id) ?? "a outra conta");
      const [origin, target] = entry.amount_cents < 0 ? [accountName, other] : [other, accountName];
      return `Excluir a transferência de ${value} de ${when}? Os dois lados saem: o valor volta para ${origin} e sai de ${target}.`;
    }
    case "saldo_inicial":
      return `Excluir o saldo inicial de ${value}? O caixa de ${accountName} fica desativado; você pode ativá-lo de novo com outra data e outro valor.`;
    default:
      return `Excluir este lançamento de ${value}?`;
  }
}

// ---- lançamentos feitos à mão ---------------------------------------------------------------

/** Teto de valor do back-end (`MAX_CENTS` em core/money.py): R$ 100 bilhões. Acima disso ele recusa. */
export const MAX_CENTS = 10 ** 13;
export const TOO_BIG = "O valor máximo aceito é R$ 100 bilhões.";

/** Ajuste: a pessoa escolhe o sentido em vez de digitar um número negativo. */
export type Direction = "in" | "out";

interface ManualKindInfo {
  label: string;
  /** Rótulo do campo de valor. */
  field: string;
  action: string;
  help: string;
  /** Concordância: "registrado" ou "registrada". */
  done: string;
  next: string;
}

export const MANUAL_KINDS: Record<ManualKind, ManualKindInfo> = {
  deposito: {
    label: "Depósito",
    field: "Valor do depósito (R$)",
    action: "Registrar depósito",
    help: "Dinheiro novo que você mandou para esta conta. Soma ao caixa e ao capital aportado.",
    done: "Depósito registrado",
    next: "Quando investir esse dinheiro, use “Comprar ativo com o caixa”: ele sai do caixa sem o aporte contar duas vezes.",
  },
  retirada: {
    label: "Retirada",
    field: "Valor da retirada (R$)",
    action: "Registrar retirada",
    help: "Dinheiro que você tirou da conta para fora dos investimentos. Sai do caixa e do capital aportado.",
    done: "Retirada registrada",
    next: "O capital aportado desta conta diminuiu na mesma medida.",
  },
  taxa: {
    label: "Taxa",
    field: "Valor da taxa (R$)",
    action: "Registrar taxa",
    help: "Custódia, corretagem ou outra cobrança. Sai do caixa; o capital aportado não muda.",
    done: "Taxa registrada",
    next: "No fim do mês, confira o caixa com o extrato.",
  },
  ajuste: {
    label: "Ajuste",
    field: "Valor do ajuste (R$)",
    action: "Registrar ajuste",
    help: "Correção do caixa sem dinheiro novo (ex.: rendimento do saldo, centavos de diferença). Não muda o capital aportado. Para acertar com o extrato, prefira “Conferir com o extrato”.",
    done: "Ajuste registrado",
    next: "No fim do mês, confira o caixa com o extrato.",
  },
};

/** Efeito do lançamento no caixa, com sinal. */
export function cashEffect(kind: ManualKind, cents: number, direction: Direction = "in"): number {
  if (kind === "deposito") return cents;
  if (kind === "ajuste") return direction === "in" ? cents : -cents;
  return -cents;
}

/** Valor enviado à API: depósito, retirada e taxa vão positivos (o tipo decide o sentido); ajuste vai com sinal. */
export function apiAmount(kind: ManualKind, cents: number, direction: Direction = "in"): number {
  return kind === "ajuste" ? cashEffect(kind, cents, direction) : cents;
}

function dateProblem(date: string, today: string, openingDate: string | null): string | null {
  if (date === "") return "Informe a data.";
  if (date > today) return "A data não pode ser no futuro.";
  if (openingDate && date < openingDate) {
    return `A data precisa ser a partir de ${formatDate(openingDate)}, quando o caixa da conta foi ativado.`;
  }
  return null;
}

/**
 * Motivo para não deixar registrar ainda (o botão fica desabilitado e o motivo aparece). Null: pode enviar.
 * Saída acima do caixa de hoje é recusada já aqui: o back-end recusaria do mesmo jeito.
 */
export function entryProblem(input: {
  kind: ManualKind;
  cents: number | null;
  direction?: Direction;
  date: string;
  today: string;
  account: Pick<Account, "balance_cents" | "opening_date">;
}): string | null {
  const { kind, cents, direction = "in", date, today, account } = input;
  if (cents === null || cents <= 0) return "Informe um valor maior que zero.";
  if (cents > MAX_CENTS) return TOO_BIG;
  const problem = dateProblem(date, today, account.opening_date);
  if (problem) return problem;
  if (cashEffect(kind, cents, direction) < 0 && cents > account.balance_cents) return "É mais do que há no caixa hoje.";
  return null;
}

export function transferProblem(input: {
  from: Account | undefined;
  to: Account | undefined;
  cents: number | null;
  date: string;
  today: string;
}): string | null {
  const { from, to, cents, date, today } = input;
  if (!from) return "Escolha a conta de origem.";
  if (!to) return "Escolha a conta de destino.";
  if (from.id === to.id) return "Escolha contas diferentes.";
  if (cents === null || cents <= 0) return "Informe um valor maior que zero.";
  if (cents > MAX_CENTS) return TOO_BIG;
  const problem = dateProblem(date, today, null);
  if (problem) return problem;
  for (const [account, role] of [
    [from, "origem"],
    [to, "destino"],
  ] as const) {
    if (account.opening_date && date < account.opening_date) {
      return `A conta de ${role} (${account.name}) só tem caixa a partir de ${formatDate(account.opening_date)}.`;
    }
  }
  if (cents > from.balance_cents) return "É mais do que há no caixa de hoje da conta de origem.";
  return null;
}

export function openingProblem(cents: number | null, date: string, today: string): string | null {
  if (cents === null || cents < 0) return "Informe o saldo em caixa (pode ser 0,00).";
  if (cents > MAX_CENTS) return TOO_BIG;
  return dateProblem(date, today, null);
}

/** Frase de sucesso: o que foi feito, como ficou o caixa e o que vem a seguir. */
export function entrySuccess(kind: ManualKind, cents: number, date: string, balanceAfter: number): MoneyTextPart[] {
  const info = MANUAL_KINDS[kind];
  return [`${info.done}: `, { cents }, ` em ${formatDate(date)}. Caixa de hoje: `, { cents: balanceAfter }, `. ${info.next}`];
}

// ---- período do extrato ---------------------------------------------------------------------

export type PeriodKey = "mes" | "3m" | "12m" | "tudo";

export const PERIODS: readonly { value: PeriodKey; label: string }[] = [
  { value: "mes", label: "Este mês" },
  { value: "3m", label: "3 meses" },
  { value: "12m", label: "12 meses" },
  { value: "tudo", label: "Tudo" },
];

/** Primeiro dia do período ("3 meses" = este mês e os dois anteriores). Sem `Date`, para não deslocar o dia. */
export function periodStart(key: PeriodKey, today: string): string | undefined {
  if (key === "tudo") return undefined;
  const back = key === "mes" ? 0 : key === "3m" ? 2 : 11;
  const [year, month] = today.split("-").map(Number);
  const index = year * 12 + (month - 1) - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export function periodLabel(key: PeriodKey, today: string): string {
  const start = periodStart(key, today);
  return start ? `de ${formatDate(start)} até hoje` : "desde o saldo inicial";
}

// ---- conciliação ----------------------------------------------------------------------------

/** Diferença da conciliação em palavras (o valor vai à parte, em <Money>). */
export function differenceWords(differenceCents: number): string {
  if (differenceCents > 0) return "a mais no extrato do que no app";
  if (differenceCents < 0) return "a menos no extrato do que no app";
  return "O caixa confere com o extrato.";
}

/** Conciliação sem diferença: numa data passada, diz que conferiu naquela data (não necessariamente hoje). */
export function matchesText(asOf: string, today: string): string {
  return asOf < today
    ? `O caixa conferia com o extrato em ${formatDate(asOf)}. Nada a ajustar nessa data; para o saldo de hoje, use a data de hoje.`
    : "O caixa confere com o extrato. Nada a ajustar.";
}

// ---- erros da API em orientação -------------------------------------------------------------

/** O que fazer depois de um erro do back-end. A mensagem dele já diz o que houve; aqui vai o próximo passo. */
export function cashErrorHint(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const message = error.message;
  if (typeof error.extra.shortfall_cents === "number" && error.status === 422) {
    return "Registre antes o depósito que trouxe esse dinheiro (com data igual ou anterior) ou diminua o valor.";
  }
  if (message.includes("ficaria negativo")) {
    return "Exclua ou corrija antes os lançamentos seguintes que usam esse dinheiro.";
  }
  if (message.includes("só tem caixa a partir de")) return "Escolha uma data a partir do saldo inicial da conta.";
  if (message.includes("ainda não tem caixa ativado")) return "Ative o caixa dessa conta (informando o saldo inicial) e tente de novo.";
  if (message.includes("está arquivada")) return "Restaure a conta em “Gerenciar conta” para voltar a lançar nela.";
  if (message.includes("ainda tem ativos")) return "Em Carteira → Ativos, arquive os ativos desta conta (ou mude a instituição deles) antes.";
  if (message.includes("Já existe uma conta com esse nome")) return "Use um nome diferente, por exemplo com o tipo da conta.";
  return null;
}
