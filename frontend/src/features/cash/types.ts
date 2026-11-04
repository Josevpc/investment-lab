export type EntryKind =
  | "saldo_inicial"
  | "deposito"
  | "provento"
  | "compra"
  | "venda"
  | "taxa"
  | "retirada"
  | "ajuste"
  | "transferencia";

export interface Account {
  id: number;
  name: string;
  institution_id: number;
  archived: boolean;
  /** Tem saldo inicial: o caixa da conta está ativado. */
  cash_enabled: boolean;
  opening_date: string | null;
  /** Caixa de hoje (0 se o caixa não está ativado). */
  balance_cents: number;
}

export interface Entry {
  id: number;
  account_id: number;
  date: string;
  kind: EntryKind;
  /** Com sinal: positivo entra no caixa, negativo sai. */
  amount_cents: number;
  asset_id: number | null;
  /** Nasceu de um movimento da carteira (aporte, compra, provento): só sai desfazendo o movimento. */
  movement_id: number | null;
  transfer_id: string | null;
  /** Só em transferência: a outra conta. */
  counterpart_account_id: number | null;
  /** Saldo da conta logo depois deste lançamento. */
  balance_cents: number;
  deletable: boolean;
}

export interface Statement {
  account_id: number;
  /** Saldo ao fim do período (ou de hoje). */
  balance_cents: number;
  /** Do mais recente para o mais antigo. */
  entries: Entry[];
}

export interface CashBalance {
  as_of: string;
  total_cents: number;
  accounts: { account_id: number; name: string; archived: boolean; cash_enabled: boolean; balance_cents: number }[];
}

export interface ContributedCapital {
  as_of: string;
  start: string | null;
  deposits_cents: number;
  withdrawals_cents: number;
  /** Depósitos menos retiradas. */
  contributed_cents: number;
  by_account: { account_id: number; name: string; contributed_cents: number }[];
}

export interface Reconciliation {
  account_id: number;
  as_of: string;
  calculated_cents: number;
  real_cents: number;
  /** Real menos calculado. */
  difference_cents: number;
}

export interface TransferResult {
  transfer_id: string;
  date: string;
  amount_cents: number;
  from_entry: Entry;
  to_entry: Entry;
}

/** Lançamentos que a pessoa faz à mão na conta. */
export type ManualKind = "deposito" | "retirada" | "taxa" | "ajuste";
