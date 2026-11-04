/**
 * Frase com valores em reais no meio ("Seu dinheiro trabalhou R$ 12,30 para você").
 * A lógica monta as partes; a tela desenha cada valor com <MoneyText> (que usa <Money> e respeita "ocultar valores").
 */
export type MoneyTextPart = string | { cents: number };
