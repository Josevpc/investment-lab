import { formatBRL, formatDate, monthName, todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { Asset, AssetUpdateInput, Movement } from "../types";

// Investimento novo x antigo: o novo é dinheiro aplicado agora e o valor do cadastro vira aporte do mês;
// o antigo já existia e só está sendo trazido para o app, então não infla os aportes.

/** "outubro", a partir de "2026-10-31". Data vazia (campo apagado) vale como hoje. */
export function monthOfDate(iso: string): string {
  return monthName((iso || todayISO()).slice(0, 7));
}

/** `date` null: ativo já cadastrado sem aporte do cadastro (o back-end usa o mês do cadastro). */
export function newOptionLabel(date: string | null): string {
  const month = date === null ? "do mês do cadastro" : `de ${monthOfDate(date)}`;
  return `Novo: estou aplicando esse dinheiro agora (conta como aporte ${month})`;
}

export const OLD_OPTION_LABEL = "Antigo: já existia, só estou trazendo para o app (não conta como aporte)";

export const NEWNESS_REQUIRED = "Escolha se o investimento é novo ou antigo.";

/** Valor e mês do aporte do cadastro, quando o back-end conhece; senão, descreve sem número. */
function initialParts(asset: Asset, capital: boolean): { amount: MoneyTextPart; month: string } {
  const amount: MoneyTextPart =
    asset.initial_contribution_cents !== null
      ? { cents: asset.initial_contribution_cents }
      : capital
        ? "O valor do cadastro"
        : "o valor do cadastro";
  const month = asset.initial_contribution_date ? ` de ${monthOfDate(asset.initial_contribution_date)}` : " do mês do cadastro";
  return { amount, month };
}

/** Na edição: o que vale hoje e o que muda ao salvar com a escolha feita. */
export function newnessEffect(asset: Asset, chosenNew: boolean): MoneyTextPart[] {
  const { amount, month } = initialParts(asset, false);
  if (chosenNew === asset.is_new_investment) {
    return chosenNew
      ? ["Hoje ", amount, ` conta como aporte${month}.`]
      : ["Hoje não conta como aporte: entrou como um investimento que já existia."];
  }
  return chosenNew
    ? ["Ao salvar, ", amount, ` entra como aporte${month}.`]
    : ["Ao salvar, ", amount, ` sai dos aportes${month}. O saldo do ativo não muda.`];
}

/** Confirmação depois de editar: diz o que mudou, inclusive no aporte do mês. */
export function assetSavedMessage(before: Asset, after: Asset): MoneyTextPart[] {
  const parts: MoneyTextPart[] = [`Alterações em ${after.name} salvas.`];
  if (before.is_new_investment === after.is_new_investment) return parts;
  if (after.is_new_investment) {
    const { amount, month } = initialParts(after, true);
    return [...parts, " ", amount, ` agora conta como aporte${month}.`];
  }
  const { amount, month } = initialParts(before, true);
  return [...parts, " ", amount, ` deixou de contar como aporte${month}; o saldo não mudou.`];
}

/** Texto da comemoração do cadastro. */
export function createdText(asset: Asset): string {
  if (asset.is_new_investment) {
    const value = formatBRL(asset.initial_contribution_cents ?? asset.invested_cents);
    const month = monthOfDate(asset.initial_contribution_date ?? asset.valuation_date);
    return `${asset.name} entrou na carteira e ${value} contam como aporte de ${month}.`;
  }
  return `${asset.name} entrou na carteira e já conta no patrimônio. Como já existia, não conta como aporte.`;
}

/** Antes de deixar de contar o aporte do cadastro: o saldo não muda, só a classificação. */
export function uncountMessage(m: Movement): string {
  return `Não contar ${formatBRL(m.amount_cents)} de ${m.asset_name} como aporte de ${monthOfDate(m.date)} (${formatDate(m.date)})? O ativo continua na carteira e o saldo não muda: ele passa a ser um investimento antigo, que já existia. Para voltar atrás, edite o ativo e marque "Novo".`;
}

export function uncountDone(m: Movement): string {
  return `${formatBRL(m.amount_cents)} de ${m.asset_name} não conta mais como aporte de ${monthOfDate(m.date)}. O saldo do ativo não mudou.`;
}

/** O PUT do ativo exige o cadastro inteiro: monta a partir do ativo, mudando só o que foi pedido. */
export function updateInputFrom(asset: Asset, patch: Partial<AssetUpdateInput> = {}): AssetUpdateInput {
  return {
    name: asset.name,
    class_key: asset.class_key,
    institution_id: asset.institution_id,
    account_id: null, // mantém a conta
    ticker: asset.ticker,
    indexer: asset.indexer,
    rate_bps: asset.rate_bps,
    maturity_date: asset.maturity_date,
    quantity: asset.quantity,
    purpose: asset.purpose,
    asset_type: asset.asset_type,
    fii_segment: asset.fii_segment,
    hold_only: asset.hold_only,
    balance_is_net: asset.balance_is_net,
    archived: asset.archived,
    is_new_investment: null,
    ...patch,
  };
}
