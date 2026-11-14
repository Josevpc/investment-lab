/*
 * Caixa de uma conta = livre + separado para comprar. Uma API anterior ao separado não manda os dois campos:
 * aí tudo é livre e nada aparece a mais na tela.
 */

interface Split {
  balance_cents: number;
  reserved_cents?: number;
  free_cents?: number;
}

/** Quanto do caixa já tem destino (separado para comprar uma categoria). */
export function reservedCents(account: Pick<Split, "reserved_cents">): number {
  return account.reserved_cents ?? 0;
}

/** Quanto do caixa não tem destino: é o que saques, taxas, transferências e compras de qualquer categoria podem usar. */
export function freeCents(account: Split): number {
  return account.free_cents ?? account.balance_cents - reservedCents(account);
}
