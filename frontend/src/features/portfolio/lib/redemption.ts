import { formatDate } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { Asset } from "../types";

// Resgate: dinheiro que sai do ativo para uso. Saem do saldo o valor e, do investido, a mesma proporção
// (assim o rendimento acumulado também cai na proporção e o resgate não aparece como prejuízo).

export const NOTE_MAX = 120;

/**
 * Custo (parte do investido) que sai com o resgate: investido x valor / saldo, arredondado meio para cima.
 * É só a prévia: vale o que o servidor responder. BigInt porque o produto passa de 2^53 em carteiras grandes.
 */
export function redemptionCostCents(investedCents: number, currentCents: number, amountCents: number): number | null {
  if (currentCents <= 0 || amountCents <= 0) return null;
  const inv = BigInt(investedCents);
  const cur = BigInt(currentCents);
  const amt = BigInt(amountCents);
  const cost = Number((2n * inv * amt + cur) / (2n * cur));
  return Math.min(cost, investedCents);
}

export interface RedemptionCheck {
  /** Erro do campo de valor (null = sem erro, mesmo vazio). */
  amountError: string | null;
  dateError: string | null;
  /** Por que o botão está desabilitado (null = pode registrar). */
  blocker: string | null;
}

/**
 * Valida antes de mandar para a API. Modo normal: a data não vem antes do último saldo e o valor cabe nele.
 * Modo "já está no saldo": o último valor registrado é o de depois do resgate, então a data não passa dele.
 */
export function checkRedemption(input: {
  asset: Asset | undefined;
  amountText: string;
  cents: number | null;
  date: string;
  today: string;
  alreadyInBalance: boolean;
}): RedemptionCheck {
  const { asset, amountText, cents, date, today, alreadyInBalance } = input;
  let amountError: string | null = null;
  let dateError: string | null = null;

  if (amountText.trim() !== "" && cents === null) amountError = "Valor inválido.";
  else if (cents !== null && cents <= 0) amountError = "O valor precisa ser maior que zero.";
  else if (asset && cents !== null && !alreadyInBalance && cents > asset.current_cents) {
    amountError = `Maior que o saldo registrado de ${asset.name} (veja o valor abaixo).`;
  }

  if (date !== "" && date > today) dateError = "Não pode ser no futuro.";
  else if (asset && date !== "" && !alreadyInBalance && date < asset.valuation_date) {
    dateError = `Antes do último saldo de ${asset.name} (${formatDate(asset.valuation_date)}). Se esse saldo já está sem o dinheiro, marque a opção abaixo.`;
  } else if (asset && date !== "" && alreadyInBalance && date > asset.valuation_date) {
    dateError = `Nesse modo, o resgate é de ${formatDate(asset.valuation_date)} ou antes, a data do último valor registrado.`;
  }

  let blocker: string | null = null;
  if (!asset) blocker = "Escolha o ativo do resgate.";
  else if (amountError) blocker = "Corrija o valor indicado acima.";
  else if (cents === null || amountText.trim() === "") blocker = "Informe o valor resgatado.";
  else if (date === "") blocker = "Informe a data do resgate.";
  else if (dateError) blocker = "Corrija a data indicada acima.";
  return { amountError, dateError, blocker };
}

/** Frase da prévia, antes de registrar. Em "já está no saldo" não há número de investido: quem calcula é o servidor. */
export function redemptionPreview(asset: Asset, cents: number, alreadyInBalance: boolean): MoneyTextPart[] {
  if (alreadyInBalance) {
    return [
      "O saldo de ",
      asset.name,
      " fica no último valor registrado (",
      { cents: asset.current_cents },
      "). Só o investido é reduzido, na proporção do resgate de ",
      { cents },
      ". Ao registrar, o servidor confere se há um saldo digitado nessa data ou depois.",
    ];
  }
  const cost = redemptionCostCents(asset.invested_cents, asset.current_cents, cents);
  if (cost === null) return [];
  return [
    "Saldo de ",
    asset.name,
    ": de ",
    { cents: asset.current_cents },
    " para ",
    { cents: asset.current_cents - cents },
    ". Investido: de ",
    { cents: asset.invested_cents },
    " para ",
    { cents: asset.invested_cents - cost },
    " (sai a mesma proporção do rendimento, então não aparece como prejuízo).",
  ];
}

export interface ReserveSnapshot {
  goal_cents: number;
  balance_cents: number;
  remaining_cents: number;
  reached: boolean;
}

/** Mensagem de sucesso: o que foi feito e o que vem a seguir. `reserve` só entra quando o ativo é da reserva. */
export function redemptionDoneParts(input: {
  assetName: string;
  amountCents: number;
  date: string;
  alreadyInBalance: boolean;
  creditedAccount: string | null;
  onReserve: boolean;
  reserve: ReserveSnapshot | null;
}): MoneyTextPart[] {
  const { assetName, amountCents, date, alreadyInBalance, creditedAccount, onReserve, reserve } = input;
  const parts: MoneyTextPart[] = ["Resgate de ", { cents: amountCents }, ` de ${assetName} registrado em ${formatDate(date)}. `];
  parts.push(
    alreadyInBalance
      ? "O saldo registrado foi mantido e só o investido foi reduzido. "
      : "O saldo e o investido do ativo foram reduzidos na mesma proporção, então não é prejuízo. ",
  );
  if (creditedAccount) parts.push(`O valor entrou no caixa de ${creditedAccount}. `);
  if (onReserve && reserve) {
    if (reserve.goal_cents <= 0) {
      parts.push("A reserva ficou com ", { cents: reserve.balance_cents }, ". Defina a meta da reserva para o app sugerir a reposição nos próximos aportes.");
    } else if (reserve.reached) {
      parts.push("A reserva continua completa, dentro da meta.");
    } else {
      parts.push(
        "A reserva está ",
        { cents: reserve.remaining_cents },
        " abaixo da meta de ",
        { cents: reserve.goal_cents },
        ". O próximo aporte já sugere repor o que falta.",
      );
    }
  } else if (!onReserve) {
    parts.push("A linha Resgates do acumulado do ano aparece a partir do próximo fechamento. Nele, atualize o saldo como de costume.");
  }
  return parts;
}
