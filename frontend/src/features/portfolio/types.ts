export type Indexer = "CDI" | "IPCA" | "PRE" | "SELIC" | "OUTRO";
export type Purpose = "reserva";
export type AssetType = "acao" | "etf" | "fii";
export type FiiSegment = "papel" | "tijolo";

export interface AssetClass {
  id: number;
  key: string;
  name: string;
  color: string;
  archived: boolean;
  /** Grupo de categorias a que pertence; ausente numa API anterior aos grupos. */
  group_id?: number | null;
}

export interface AssetClassInput {
  name: string;
  color: string;
  archived: boolean;
  /** null tira a categoria do grupo; omitir mantém o atual. */
  group_id?: number | null;
}

export interface Institution {
  id: number;
  name: string;
}

export interface Asset {
  id: number;
  name: string;
  ticker: string | null;
  class_key: string;
  class_name: string;
  institution_id: number;
  institution_name: string;
  indexer: Indexer | null;
  rate_bps: number | null;
  maturity_date: string | null;
  quantity: string | null;
  archived: boolean;
  /** Manter posição: não recebe novos aportes, mas continua contando na carteira e nas metas. */
  hold_only: boolean;
  /** O saldo digitado já vem com o IR descontado (ex.: Caixinha do Mercado Pago); falso = bruto. */
  balance_is_net: boolean;
  purpose: Purpose | null;
  asset_type: AssetType | null;
  fii_segment: FiiSegment | null;
  /** Conta (caixa) onde o ativo fica; por padrão, a conta da instituição. */
  account_id: number | null;
  invested_cents: number;
  current_cents: number;
  /** Rendimento: atual - investido. */
  gain_cents: number;
  return_bps: number | null;
  /** Proventos recebidos (dividendos, rendimentos de FIIs). */
  proventos_cents: number;
  /** Rentabilidade somando os proventos. */
  total_return_bps: number | null;
  valuation_date: string;
  /** Novo: o valor do cadastro foi dinheiro aplicado na hora e conta como aporte. Antigo: já existia. */
  is_new_investment: boolean;
  /** Aporte gravado no cadastro de um investimento novo (null no antigo). */
  initial_contribution_cents: number | null;
  initial_contribution_date: string | null;
}

export interface AssetFields {
  name: string;
  class_key: string;
  institution_id: number;
  /** null: na criação, a conta padrão da instituição; na edição, mantém a conta atual. */
  account_id: number | null;
  ticker: string | null;
  indexer: Indexer | null;
  rate_bps: number | null;
  maturity_date: string | null;
  quantity: string | null;
  purpose: Purpose | null;
  asset_type: AssetType | null;
  fii_segment: FiiSegment | null;
  /** O back-end recusa (422) ativo arquivado marcado como mantido. */
  hold_only: boolean;
  /** Só rotula o desempenho contra o CDI: o app não calcula imposto. Vale só para renda fixa. */
  balance_is_net: boolean;
}

export interface AssetCreateInput extends AssetFields {
  /** Sem valor, o back-end assume o mesmo valor atual. */
  invested_cents: number | null;
  current_cents: number;
  valuation_date?: string;
  /** Obrigatório no cadastro: novo vira aporte do mês; antigo não conta como aporte. */
  is_new_investment: boolean;
}

export interface AssetUpdateInput extends AssetFields {
  archived: boolean;
  /** null mantém como está. */
  is_new_investment: boolean | null;
}

export interface BalanceInput {
  date?: string;
  /** Saldo do extrato, já com o aporte do mês. */
  balance_cents: number;
  /** Dinheiro novo depositado no mês. */
  contribution_cents: number;
  /** Dia do aporte, se diferente do dia do saldo (entra no cálculo do % do CDI). */
  contribution_date?: string;
  /** Só para corrigir o valor investido. */
  invested_cents?: number | null;
  /** Só para contas com caixa ativado: o aporte sai do caixa que já está na conta (só a compra), em vez de
   * entrar como dinheiro novo (depósito + compra). */
  use_cash?: boolean;
  /** Moedas compradas no aporte (cripto): o back-end soma à quantidade do ativo. */
  quantity_added?: string;
}

export type MovementKind = "aporte" | "provento" | "transferencia" | "resgate";

export interface Movement {
  id: number;
  date: string;
  kind: MovementKind;
  asset_id: number;
  asset_name: string;
  related_asset_id: number | null;
  related_asset_name: string | null;
  amount_cents: number;
  cost_cents: number | null;
  /** Aporte gerado pelo cadastro de um investimento novo (não se edita; pode deixar de contar). */
  initial: boolean;
  /** Motivo do resgate (texto livre, até 120 caracteres). Só o resgate tem. */
  note: string | null;
  /** Resgate com "o saldo que digitei já está sem esse dinheiro": só o investido foi ajustado. */
  in_balance: boolean;
}

/** Correção de um movimento: ao menos um campo. O motivo (`note`) só vale no resgate, que não muda valor nem data. */
export interface MovementUpdateInput {
  amount_cents?: number;
  date?: string;
  note?: string | null;
}

/** Dinheiro que saiu do ativo para uso (não é perda): reduz o saldo e o investido, na proporção. */
export interface RedemptionInput {
  asset_id: number;
  amount_cents: number;
  date?: string;
  /** Até 120 caracteres; vazio vira null. */
  note: string | null;
  /** A venda entra no caixa da conta do ativo (só com o caixa ativado). */
  credit_cash: boolean;
  /** O saldo digitado já está sem esse dinheiro: o app só ajusta o investido, para não descontar duas vezes. */
  already_in_balance: boolean;
}

export interface TransferInput {
  from_asset_id: number;
  to_asset_id: number;
  amount_cents: number;
  date?: string;
}

export interface ProventoInput {
  asset_id: number;
  amount_cents: number;
  date?: string;
  credited_asset_id?: number | null;
}

/** Compra de um ativo com o caixa da conta dele. */
export interface PurchaseInput {
  asset_id: number;
  amount_cents: number;
  date?: string;
  /** Caixa insuficiente: grava antes um depósito desse valor (dinheiro novo). */
  deposit_cents?: number;
}

export interface PurchaseResult {
  movement: Movement;
  account_id: number;
  deposit_cents: number;
  /** Caixa da conta ao fim do dia da compra. */
  cash_balance_cents: number;
}

export interface MonthSummary {
  month: string;
  by_class: { class_key: string; class_name: string; color: string; amount_cents: number }[];
  reserve_cents: number;
  /** registered_cents + new_assets_cents. */
  total_cents: number;
  proventos_cents: number;
  /** Dinheiro resgatado no mês. */
  redemptions_cents: number;
  /** Aportes lançados nos ativos. */
  registered_cents: number;
  /** Investimentos novos cadastrados no mês (o valor do cadastro conta como aporte). */
  new_assets_cents: number;
  new_assets: { asset_id: number; asset_name: string; amount_cents: number }[];
}

export interface ClassBreakdown {
  class_id: number;
  class_key: string;
  class_name: string;
  color: string;
  current_cents: number;
  invested_cents: number;
  share_bps: number;
}

export interface InstitutionBreakdown {
  institution_id: number;
  institution_name: string;
  current_cents: number;
  invested_cents: number;
  share_bps: number;
}

export interface GroupBreakdown {
  group_id: number;
  name: string;
  color: string;
  current_cents: number;
  invested_cents: number;
  /** Participação nos investimentos (sem a reserva). Categorias sem grupo ficam de fora. */
  share_bps: number;
}

export interface PortfolioSummary {
  /** Totais incluem a reserva; `by_class` cobre só os investimentos. */
  total_current_cents: number;
  total_invested_cents: number;
  return_bps: number | null;
  assets_count: number;
  investments_current_cents: number;
  reserve_current_cents: number;
  reserve_invested_cents: number;
  proventos_cents: number;
  /** Dinheiro parado nas contas (caixa), fora dos totais acima. */
  cash_cents: number;
  total_with_cash_cents: number;
  by_class: ClassBreakdown[];
  /** Ausente numa API anterior aos grupos; só traz grupos com categorias. */
  by_group?: GroupBreakdown[];
  by_type: TypeBreakdown[];
  fii_segments: FiiSegmentBreakdown[];
  /** Ativos de renda variável ainda sem tipo definido. */
  untyped_count: number;
  untyped_current_cents: number;
  by_institution: InstitutionBreakdown[];
}

export interface Valuation {
  id: number;
  asset_id: number;
  date: string;
  invested_cents: number;
  current_cents: number;
}

export interface ValuationUpdateInput {
  date: string;
  invested_cents: number;
  current_cents: number;
}

export interface TypeBreakdown {
  asset_type: AssetType;
  label: string;
  assets_count: number;
  current_cents: number;
  invested_cents: number;
  /** Participação entre os ativos que têm tipo. */
  share_bps: number;
}

export interface FiiSegmentBreakdown {
  segment: FiiSegment | "sem_segmento";
  label: string;
  assets_count: number;
  current_cents: number;
  invested_cents: number;
  proventos_cents: number;
  /** Participação dentro dos fundos imobiliários. */
  share_bps: number;
}

/** Um resgate, como a tela de Retiradas o mostra. */
export interface Withdrawal {
  movement_id: number;
  date: string;
  /**
   * Data do saldo que mostra como a reserva ficou. Resgate comum: a própria data do resgate. Resgate `in_balance`:
   * o primeiro saldo digitado em data >= a do resgate. null só em `in_balance` sem saldo digitado a partir da data.
   */
  effective_date: string | null;
  asset_id: number;
  asset_name: string;
  institution_name: string;
  asset_archived: boolean;
  amount_cents: number;
  cost_cents: number;
  note: string | null;
  in_balance: boolean;
  from_reserve: boolean;
  /** Saldo da reserva naquele saldo (histórico); null sem effective_date. */
  reserve_balance_after_cents: number | null;
  /** Quanto faltava para a meta ATUAL da reserva naquele saldo; 0 = dentro da meta; null sem dado ou sem meta. */
  reserve_below_goal_cents: number | null;
}

export interface WithdrawalList {
  items: Withdrawal[];
  total_cents: number;
  count: number;
  reserve_total_cents: number;
  /** Anos com retirada, do conjunto todo (não só do filtro), do mais novo ao mais antigo. */
  years: number[];
}
